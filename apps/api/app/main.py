import json
import math
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request, Response, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .core import ROOT,DATA_DIR,UI_TOKEN,AGENT_TOKEN,MAX_UPLOAD
from .db import connect, init_db, now, uid, dumps, settings as read_settings, set_setting, log
from .schemas import NoteInput, CardUpdate, ImportInput, OptimizeInput, AuditInput, SettingsInput, LinkInput, EvidenceInput, DirectRevisionInput, CaptureInput, RegenerateInput
from .services.cards import create_note,update_card,get_card,list_cards,require,serialize_card,revision,reindex
from .services.imports import preview
from .services.knowledge import import_document
from .services.backup import create_backup,restore_backup
from .workers import queue
from .adapters.conversations import ImportProblem

@asynccontextmanager
async def lifespan(app):
    init_db();thread=queue.start()
    from .workers import experience_queue
    experience_thread=experience_queue.start()
    yield
    queue.STOP.set();experience_queue.STOP.set();thread.join(timeout=5);experience_thread.join(timeout=2)

app=FastAPI(title='CardSpace API',version='0.4.0',lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','[::1]','testserver'])

@app.exception_handler(ImportProblem)
async def import_error(request,exc):return JSONResponse(status_code=422,content={'detail':str(exc)})


def validate_origin(request):
    origin=request.headers.get('origin')
    if origin:
        parsed=urlparse(origin)
        if parsed.scheme!='http' or parsed.hostname not in ('localhost','127.0.0.1','::1') or parsed.port not in (5173,8765,int(__import__('os').getenv('CARDSPACE_PORT','8765'))):
            raise HTTPException(403,'不允许的请求来源')
    if request.headers.get('sec-fetch-site')=='cross-site':raise HTTPException(403,'不允许跨站请求')

def session_cookie_name(request:Request):
    # Cookies ignore ports: isolate local services and their data directories.
    return 'cardspace_session_'+str(request.url.port or 80)

def actor(request:Request):
    validate_origin(request)
    token=request.headers.get('authorization','')
    if token.startswith('Bearer '):
        supplied=token[7:]
        if secrets.compare_digest(supplied,AGENT_TOKEN):return 'agent'
        # UI credentials are intentionally never exposed as API tokens.
    if secrets.compare_digest(request.cookies.get(session_cookie_name(request),''),UI_TOKEN):return 'human'
    raise HTTPException(401,'请刷新页面连接本地服务，Agent 请配置 Bearer token。')

def human(who=Depends(actor)):
    if who!='human':raise HTTPException(403,'此操作需要人类用户在界面中确认。')
    return who

from .experience_routes import router as experience_router
app.include_router(experience_router(actor,human))

@app.get('/api/health')
def health():return {'status':'ok','version':'0.4.0'}

@app.post('/api/v1/session')
def session(request:Request,response:Response):
    validate_origin(request)
    # Browsers must prove an app-origin custom header, blocking no-cors form posts.
    if request.headers.get('x-cardspace-client')!='web':raise HTTPException(403,'仅支持本地应用会话')
    response.set_cookie(session_cookie_name(request),UI_TOKEN,httponly=True,samesite='strict',path='/api',max_age=60*60*24*30)
    return {'connected':True}

@app.get('/api/v1/stats')
def stats(who=Depends(actor)):
    with connect() as db:
        return {'last_change':db.execute('SELECT max(timestamp) FROM operation_logs').fetchone()[0], 'cards':db.execute('SELECT count(*) FROM cards WHERE archived=0').fetchone()[0], 'conversations':db.execute('SELECT count(*) FROM cards WHERE archived=0 AND conversation_id IS NOT NULL').fetchone()[0], 'memories':db.execute('SELECT count(*) FROM question_memories q JOIN cards c ON c.conversation_id=q.conversation_id WHERE c.archived=0').fetchone()[0], 'favorites':db.execute('SELECT count(*) FROM cards WHERE archived=0 AND favorite=1').fetchone()[0], 'findings':db.execute("SELECT count(*) FROM audit_findings f JOIN cards c ON c.id=f.target_id WHERE f.status='open' AND c.archived=0").fetchone()[0], 'documents':db.execute('SELECT count(*) FROM knowledge_documents').fetchone()[0], 'pending':db.execute("SELECT count(*) FROM approval_requests WHERE status='pending'").fetchone()[0], 'tags':[dict(r) for r in db.execute('SELECT j.value name,count(*) count FROM cards c,json_each(c.tags) j WHERE c.archived=0 GROUP BY j.value ORDER BY count(*) DESC LIMIT 30')]}

@app.get('/api/v1/cards')
@app.get('/api/v1/search')
def cards(q:str='',kind:str='',tag:str='',favorite:bool=False,archived:bool=False,sort:str='updated',offset:int=Query(0,ge=0),limit:int=Query(60,ge=1,le=100),source:str='',days:int=Query(0,ge=0,le=36500),who=Depends(actor)):
    return list_cards(q,kind,tag,favorite,archived,sort,offset,limit,source,days)

@app.post('/api/v1/captures',status_code=202)
def capture_text(payload:CaptureInput,who=Depends(actor)):
    from .services.capture import submit
    return submit(payload.content.encode('utf8'),actor=who)

@app.post('/api/v1/captures/file',status_code=202)
async def capture_file(file:UploadFile=File(...),who=Depends(actor)):
    from .services.capture import submit
    return submit(await read_upload(file),Path(file.filename or 'attachment').name,who)

@app.get('/api/v1/captures')
def capture_list(who=Depends(actor)):
    with connect() as db:
        return [{**dict(r),'result':json.loads(r['result']) if r['result'] else None} for r in db.execute("SELECT id,filename,status,route,result,error,job_id,created_at,updated_at FROM captures WHERE status!='completed' AND NOT EXISTS (SELECT 1 FROM operation_logs l WHERE l.target_id=captures.id AND l.action='capture.dismiss') ORDER BY created_at DESC LIMIT 30")]

@app.get('/api/v1/captures/{capture_id}')
def capture_status(capture_id:str,who=Depends(actor)):
    from .services.capture import read
    return read(capture_id)

@app.post('/api/v1/captures/{capture_id}/dismiss')
def dismiss_capture(capture_id:str,who=Depends(human)):
    with connect() as db:
        c=require(db,'captures',capture_id)
        if c['status'] in ('saved','processing'):raise HTTPException(409,'请等待处理结束。')
        log(db,who,'capture.dismiss',capture_id)
    return {'dismissed':True}

@app.get('/api/v1/captures/{capture_id}/raw')
def capture_raw(capture_id:str,who=Depends(actor)):
    with connect() as db:c=require(db,'captures',capture_id)
    return Response(content=c['raw'],media_type='application/octet-stream',headers={'Content-Disposition':"attachment; filename=original-input.bin"})

@app.post('/api/v1/captures/{capture_id}/retry',status_code=202)
def capture_retry(capture_id:str,who=Depends(actor)):
    with connect() as db:
        c=require(db,'captures',capture_id)
        if c['status'] not in ('failed','saved'):raise HTTPException(409,'此记录无需重试。')
        db.execute("UPDATE captures SET status='saved',error=NULL,updated_at=? WHERE id=?",(now(),capture_id))
    jid=queue.enqueue('capture',{'capture_id':capture_id},who)
    with connect() as db:db.execute('UPDATE captures SET job_id=? WHERE id=?',(jid,capture_id))
    return {'job_id':jid}

@app.post('/api/v1/cards/{card_id}/regenerate')
def regenerate(card_id:str,payload:RegenerateInput,who=Depends(human)):
    from .services.enrichment import rules
    with connect() as db:
        if require(db,'cards',card_id)['current_revision_id']!=payload.expected_revision_id:raise HTTPException(409,'卡片已更新，请重试。')
        rules(card_id,payload.field)
    return get_card(card_id)

@app.get('/api/v1/cards/{card_id}/reference-candidates')
def reference_candidates(card_id:str,who=Depends(actor)):
    import re
    c=get_card(card_id)
    terms=re.findall(r'[a-zA-Z0-9_]{3,}|[\u4e00-\u9fff]{2,}',c['title']+' '+' '.join(c['tags']))
    tokens=set(t.lower() for t in terms)
    for t in terms:
        if re.search(r'[\u4e00-\u9fff]',t):tokens.update(t[i:i+2] for i in range(len(t)-1))
    with connect() as db:
        ranked=[]
        for row in db.execute('SELECT k.*,d.title document_title FROM knowledge_chunks k JOIN knowledge_documents d ON d.id=k.document_id WHERE k.id NOT IN (SELECT chunk_id FROM evidence WHERE card_id=?) LIMIT 5000',(card_id,)):
            score=sum(t in row['text'].lower() for t in tokens)
            if score:ranked.append((score,dict(row)))
    return [r for _,r in sorted(ranked,key=lambda item:item[0],reverse=True)[:5]]

@app.post('/api/v1/search/supplement')
def search_supplement(payload:dict,who=Depends(human)):
    from .services.search import supplement
    return supplement(payload)

@app.get('/api/v1/models')
def models(who=Depends(human)):
    from .adapters.model import discover_models
    try:return {'items':discover_models()}
    except ValueError as exc:raise HTTPException(422,str(exc))

@app.post('/api/v1/notes')
@app.post('/api/v1/cards')
def notes(payload:NoteInput,who=Depends(actor)):return create_note(payload,who)

@app.get('/api/v1/cards/{card_id}')
def card(card_id:str,who=Depends(actor)):return get_card(card_id)

@app.patch('/api/v1/cards/{card_id}')
def edit_card(card_id:str,payload:CardUpdate,who=Depends(actor)):
    result=update_card(card_id,payload,who)
    if who=='human' and any(k in payload.model_fields_set for k in ('content','title','summary','tags')):
        from .services.enrichment import schedule_index
        schedule_index(card_id)
    return result

@app.post('/api/v1/cards/{card_id}/revisions',status_code=201)
def propose_direct_revision(card_id:str,payload:DirectRevisionInput,who=Depends(actor)):
    with connect() as db:
        c=require(db,'cards',card_id)
        if payload.expected_revision_id!=c['current_revision_id']:raise HTTPException(409,'卡片版本已变化，请重新读取。')
        rid=revision(db,card_id,payload.content,payload.title,payload.summary,payload.tags,who,'proposed',payload.instruction,'external-agent')
        aid=uid('approval')
        db.execute('INSERT INTO approval_requests VALUES(?,?,?,?,?,?)',(aid,'revision',card_id,rid,'pending',now()))
        return {'revision_id':rid,'approval_id':aid,'status':'proposed'}

@app.get('/api/v1/cards/{card_id}/revisions')
def history(card_id:str,who=Depends(actor)):
    with connect() as db:
        require(db,'cards',card_id)
        result=[dict(r) for r in db.execute('SELECT * FROM card_revisions WHERE card_id=? ORDER BY created_at DESC',(card_id,))]
        for r in result:r['tags']=json.loads(r['tags'])
        return result

@app.post('/api/v1/cards/{card_id}/revisions/{revision_id}/restore')
def restore_revision(card_id:str,revision_id:str,payload:dict,who=Depends(human)):
    with connect() as db:
        c=require(db,'cards',card_id);r=require(db,'card_revisions',revision_id)
        if r['card_id']!=card_id:raise HTTPException(404,'版本不属于此卡片')
        if payload.get('expected_revision_id')!=c['current_revision_id']:raise HTTPException(409,'当前版本已变化，请重新读取。')
        if r['status']!='accepted':raise HTTPException(422,'候选版本请通过审批后使用。')
        revision(db,card_id,r['content'],r['title'],r['summary'],json.loads(r['tags']),'human',instruction='恢复历史版本 '+revision_id)
        from .services.enrichment import own
        for field in ('title','summary','content','tags'):own(db,card_id,field,strategy='human-restored')
        result=serialize_card(db,require(db,'cards',card_id),True)
    from .services.enrichment import schedule_index
    schedule_index(card_id)
    return result

@app.get('/api/v1/cards/{card_id}/related')
def related(card_id:str,who=Depends(actor)):
    card=get_card(card_id)
    result=list_cards(q=' '.join(card['tags']) or card['title'],limit=12)['items']
    return [r for r in result if r['id']!=card_id]

@app.post('/api/v1/cards/{card_id}/links')
def link(card_id:str,payload:LinkInput,who=Depends(human)):
    if card_id==payload.target_card_id:raise HTTPException(422,'不能关联自身')
    with connect() as db:
        require(db,'cards',card_id);require(db,'cards',payload.target_card_id)
        a,b=sorted([card_id,payload.target_card_id]);db.execute('INSERT OR IGNORE INTO card_links VALUES(?,?,?,?)',(a,b,'related','accepted'));log(db,who,'card.link',a,{'target':b})
    return {'linked':True}

@app.delete('/api/v1/cards/{card_id}/links/{target_id}')
def unlink(card_id:str,target_id:str,who=Depends(human)):
    with connect() as db:
        a,b=sorted([card_id,target_id]);db.execute('DELETE FROM card_links WHERE source_card_id=? AND target_card_id=?',(a,b));log(db,who,'card.unlink',a,{'target':b})
    return {'unlinked':True}

@app.get('/api/v1/conversations')
def conversations(who=Depends(actor)):
    with connect() as db:return [dict(r) for r in db.execute('SELECT c.*,count(m.id) message_count FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100')]

@app.get('/api/v1/conversations/{conversation_id}')
def conversation(conversation_id:str,who=Depends(actor)):
    with connect() as db:
        c=require(db,'conversations',conversation_id);c['warnings']=json.loads(c['warnings']);c['messages']=[dict(r) for r in db.execute('SELECT * FROM messages WHERE conversation_id=? ORDER BY position',(conversation_id,))]
        for message in c['messages']:
            meta=db.execute('SELECT data FROM message_metadata WHERE message_id=?',(message['id'],)).fetchone()
            if meta:message['metadata']=json.loads(meta['data'])
        c['memories']=memories(conversation_id,who)
        return c

@app.get('/api/v1/conversations/{conversation_id}/memories')
def memories(conversation_id:str,who=Depends(actor)):
    with connect() as db:
        require(db,'conversations',conversation_id)
        rows=[dict(r) for r in db.execute('SELECT * FROM question_memories WHERE conversation_id=?',(conversation_id,))]
        for r in rows:r['message_ids']=[x[0] for x in db.execute('SELECT message_id FROM memory_messages WHERE memory_id=? ORDER BY position',(r['id'],))]
        return rows

@app.get('/api/v1/memories/{memory_id}')
def memory(memory_id:str,who=Depends(actor)):
    with connect() as db:
        m=require(db,'question_memories',memory_id)
        m['messages']=[dict(r) for r in db.execute('SELECT m.* FROM memory_messages mm JOIN messages m ON m.id=mm.message_id WHERE mm.memory_id=? ORDER BY mm.position',(memory_id,))]
        return m

@app.get('/api/v1/snapshots/{snapshot_id}')
def raw_snapshot(snapshot_id:str,who=Depends(actor)):
    with connect() as db:
        snap=require(db,'source_snapshots',snapshot_id)
        return Response(content=snap['raw'],media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="{snapshot_id}.raw"','X-Content-SHA256':snap['hash']})

@app.post('/api/v1/imports/preview')
def import_preview(payload:ImportInput,who=Depends(actor)):return preview(payload)

@app.post('/api/v1/imports',status_code=202)
def imports(payload:ImportInput,who=Depends(actor)):
    preview(payload)
    return {'job_id':queue.enqueue('import',payload.model_dump(),who),'status':'accepted'}

@app.post('/api/v1/optimization-jobs',status_code=202)
def optimization(payload:OptimizeInput,who=Depends(actor)):
    get_card(payload.card_id)
    if payload.use_ai:
        from .adapters.model import config
        try:config()
        except ValueError as exc:raise HTTPException(422,str(exc))
    return {'job_id':queue.enqueue('optimization',payload.model_dump(),who)}

@app.post('/api/v1/audit-jobs',status_code=202)
def audit(payload:AuditInput,who=Depends(actor)):return {'job_id':queue.enqueue('audit',payload.model_dump(),who)}

@app.get('/api/v1/jobs')
def jobs(who=Depends(actor)):
    with connect() as db:
        rows=[dict(r) for r in db.execute('SELECT id,job_type,status,progress,attempts,result,error,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 60')]
        for r in rows:r['result']=json.loads(r['result']) if r['result'] else None
        return rows

@app.get('/api/v1/jobs/{job_id}')
def job(job_id:str,who=Depends(actor)):
    with connect() as db:
        r=require(db,'jobs',job_id);r.pop('input',None);r['result']=json.loads(r['result']) if r['result'] else None;return r

@app.post('/api/v1/jobs/{job_id}/cancel')
def cancel(job_id:str,who=Depends(actor)):
    with connect() as db:
        j=require(db,'jobs',job_id)
        if j['job_type']=='experience_generate':
            human(who)
            from .services.experiences import cancel as cancel_experience
            row=db.execute('SELECT id FROM experience_runs WHERE job_id=?',(job_id,)).fetchone()
            return cancel_experience(row['id'])
        if j['status'] not in ('queued','running'):raise HTTPException(409,'任务已经结束，无需取消。')
        db.execute("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=?",(now(),job_id))
        if j['job_type']=='capture' and j['status']=='queued':db.execute("UPDATE captures SET status='failed',error='处理已取消，原始输入仍保留，可重试。',updated_at=? WHERE job_id=?",(now(),job_id))
        log(db,who,'job.cancel',job_id)
    return {'cancelled':True,'notice':'已提交取消；已提交的原始资料会保留。'}

@app.post('/api/v1/jobs/{job_id}/retry')
def retry(job_id:str,who=Depends(actor)):
    with connect() as db:
        j=require(db,'jobs',job_id)
        if j['job_type']=='experience_generate':raise HTTPException(409,'请在演示中重新报价或明确确认继续，不能通过通用重试调用模型。')
        if j['status'] not in ('failed','cancelled'):raise HTTPException(409,'仅失败或取消任务可以重试')
        db.execute("UPDATE jobs SET status='queued',error=NULL,progress=0,updated_at=? WHERE id=?",(now(),job_id));log(db,who,'job.retry',job_id)
    return {'job_id':job_id}

@app.get('/api/v1/findings')
def findings(status:str='open',who=Depends(actor)):
    with connect() as db:return [dict(r) for r in db.execute('SELECT f.*,c.title card_title FROM audit_findings f JOIN cards c ON c.id=f.target_id WHERE f.status=? AND c.archived=0 ORDER BY f.created_at DESC LIMIT 500',(status,))]

@app.post('/api/v1/findings/{finding_id}/resolve')
def resolve(finding_id:str,payload:dict,who=Depends(human)):
    status=payload.get('status','resolved')
    if status not in ('resolved','dismissed','open'):raise HTTPException(422,'无效状态')
    with connect() as db:
        require(db,'audit_findings',finding_id);db.execute('UPDATE audit_findings SET status=? WHERE id=?',(status,finding_id));log(db,who,'finding.'+status,finding_id)
    return {'status':status}

@app.get('/api/v1/approvals')
def approvals(who=Depends(actor)):
    with connect() as db:return [dict(r) for r in db.execute("SELECT a.*,c.title,r.content proposed_content,r.summary proposed_summary,r.title proposed_title,r.tags proposed_tags,r.model,r.parent_revision_id FROM approval_requests a JOIN cards c ON c.id=a.target_id LEFT JOIN card_revisions r ON r.id=a.revision_id WHERE a.status='pending' ORDER BY a.created_at DESC")]

@app.post('/api/v1/approvals/{approval_id}/{decision}')
def approval(approval_id:str,decision:str,who=Depends(human)):
    if decision not in ('approve','reject'):raise HTTPException(422,'无效审批动作')
    with connect() as db:
        a=require(db,'approval_requests',approval_id)
        if a['status']!='pending':raise HTTPException(409,'该申请已经处理')
        r=require(db,'card_revisions',a['revision_id']);c=require(db,'cards',a['target_id'])
        if decision=='approve':
            if c['current_revision_id']!=r['parent_revision_id']:raise HTTPException(409,'原版本已变化，请拒绝此建议后重新整理。')
            db.execute("UPDATE card_revisions SET status='accepted' WHERE id=?",(r['id'],))
            db.execute('UPDATE cards SET title=?,summary=?,tags=?,current_revision_id=?,updated_at=? WHERE id=?',(r['title'],r['summary'],r['tags'],r['id'],now(),c['id']));reindex(db,c['id'])
            from .services.enrichment import own
            for field in ('title','summary','content','tags'):own(db,c['id'],field,strategy='human-approved')
        else:db.execute("UPDATE card_revisions SET status='rejected' WHERE id=?",(r['id'],))
        db.execute('UPDATE approval_requests SET status=? WHERE id=?',('approved' if decision=='approve' else 'rejected',approval_id));log(db,who,'approval.'+decision,approval_id)
    if decision=='approve':
        from .services.enrichment import schedule_index
        schedule_index(a['target_id'])
    return {'status':'approved' if decision=='approve' else 'rejected'}

async def read_upload(file,max_size=MAX_UPLOAD):
    blob=await file.read(max_size+1)
    if len(blob)>max_size:raise HTTPException(413,f'文件超过 {max_size//1024//1024}MB 限制')
    if not blob:raise HTTPException(422,'文件内容为空')
    return blob

@app.post('/api/v1/knowledge-documents')
async def upload_document(file:UploadFile=File(...),who=Depends(actor)):
    blob=await read_upload(file)
    try:return import_document(file.filename or 'document.txt',blob,who)
    except HTTPException:raise
    except Exception as exc:raise HTTPException(422,'无法解析文件，请检查是否为有效且未加密的文档。') from exc

@app.get('/api/v1/knowledge-documents')
def documents(q:str='',who=Depends(actor)):
    with connect() as db:
        return [dict(r) for r in db.execute('SELECT d.*,count(k.id) chunk_count FROM knowledge_documents d JOIN knowledge_chunks k ON k.document_id=d.id WHERE d.title LIKE ? OR k.text LIKE ? GROUP BY d.id ORDER BY d.created_at DESC',('%'+q+'%','%'+q+'%'))]

@app.get('/api/v1/knowledge-documents/{document_id}')
def document(document_id:str,who=Depends(actor)):
    with connect() as db:
        d=require(db,'knowledge_documents',document_id);d['chunks']=[dict(r) for r in db.execute('SELECT * FROM knowledge_chunks WHERE document_id=? ORDER BY position',(document_id,))];return d

@app.post('/api/v1/knowledge-documents/{document_id}/to-note')
def document_to_note(document_id:str,who=Depends(human)):
    from .services.knowledge import parse_document
    with connect() as db:
        d=require(db,'knowledge_documents',document_id);snapshot=require(db,'source_snapshots',d['snapshot_id'])
    content='\n\n'.join(text for _,text in parse_document(d['filename'],bytes(snapshot['raw'])))
    if len(content)>2_000_000:raise HTTPException(422,'文档过长，请选取需要的段落保存为笔记。')
    return create_note(NoteInput(title=d['title'],content=content),who)

@app.post('/api/v1/evidence')
def evidence(payload:EvidenceInput,who=Depends(human)):
    with connect() as db:
        require(db,'cards',payload.card_id);require(db,'knowledge_chunks',payload.chunk_id)
        db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?)',(uid('evidence'),payload.card_id,payload.chunk_id,payload.claim_ref,'reference',now()));log(db,who,'evidence.link',payload.card_id,{'chunk_id':payload.chunk_id})
    return {'linked':True,'verdict':'reference'}

@app.get('/api/v1/project/license')
def project_license(who=Depends(actor)):
    return FileResponse(ROOT/'LICENSE',media_type='text/plain; charset=utf-8')

@app.get('/api/v1/project/source')
def project_source(who=Depends(human)):
    from scripts.package_source import build_source_archive
    return Response(content=build_source_archive(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="cardspace-source.zip"'})

@app.get('/api/v1/settings')
def get_settings(who=Depends(human)):
    from .adapters.model import get_key
    with connect() as db:cfg=read_settings(db)
    return {**cfg,'data_dir':str(DATA_DIR),'has_api_key':bool(get_key()),'agent_token_path':str(DATA_DIR/'agent.token')}

@app.patch('/api/v1/settings')
def save_settings(payload:SettingsInput,who=Depends(human)):
    from .adapters.model import save_key,validate_base
    values=payload.model_dump(exclude_none=True)
    if 'model_base_url' in values:values['model_base_url']=validate_base(values['model_base_url'])
    if 'api_key' in values:save_key(values.pop('api_key'))
    with connect() as db:
        for k,v in values.items():set_setting(db,k,v)
        if 'audit_interval_days' in values or 'auto_audit' in values:set_setting(db,'next_audit_at','')
        log(db,who,'settings.update',detail={'keys':list(values)})
    return {'saved':True}

@app.get('/api/v1/operation-logs')
def logs(who=Depends(human)):
    with connect() as db:return [dict(r) for r in db.execute('SELECT * FROM operation_logs ORDER BY timestamp DESC LIMIT 100')]

@app.post('/api/v1/backups')
def backup(who=Depends(human)):
    path=create_backup(who);return {'filename':path.name,'download_url':'/api/v1/backups/'+path.name}

@app.get('/api/v1/backups/{filename}')
def download_backup(filename:str,who=Depends(human)):
    from .core import BACKUP_DIR
    if Path(filename).name!=filename or not filename.startswith('cardspace-') or not filename.endswith('.zip'):raise HTTPException(404)
    path=BACKUP_DIR/filename
    if not path.is_file():raise HTTPException(404)
    return FileResponse(path,filename=filename,media_type='application/zip')

@app.post('/api/v1/restore')
async def restore(file:UploadFile=File(...),who=Depends(human)):
    return restore_backup(await read_upload(file,512*1024*1024),who)

@app.post('/api/v1/embedding-jobs',status_code=202)
def index_embeddings(who=Depends(human)):
    from .adapters.model import config
    try:config()
    except ValueError as exc:raise HTTPException(422,str(exc))
    return {'job_id':queue.enqueue('embeddings',{},who)}

@app.post('/api/v1/memory-search')
def memory_search(payload:dict,who=Depends(actor)):
    query=str(payload.get('query',''))[:2000];limit=max(1,min(int(payload.get('limit',10)),50))
    result=list_cards(q=query,limit=limit)
    if not payload.get('semantic'):return {**result,'mode':'keyword'}
    from .adapters.model import embed
    try:vectors,model=embed([query])
    except ValueError as exc:raise HTTPException(422,str(exc))
    vector=vectors[0]
    def cosine(v):
        if len(v)!=len(vector):return 0
        denom=math.sqrt(sum(x*x for x in v)*sum(x*x for x in vector))
        return sum(a*b for a,b in zip(v,vector))/denom if denom else 0
    with connect() as db:
        indexed=[(r['card_id'],cosine(json.loads(r['vector']))) for r in db.execute('SELECT e.* FROM embeddings e JOIN cards c ON c.id=e.card_id AND c.current_revision_id=e.revision_id WHERE e.model=? AND c.archived=0',(model,))]
    indexed.sort(key=lambda x:x[1],reverse=True)
    scores={};merged={r['id']:r for r in result['items']}
    for rank,c in enumerate(result['items']):scores[c['id']]=1/(60+rank+1)
    for rank,(cid,score) in enumerate(indexed[:limit]):
        if score<.2:continue
        scores[cid]=scores.get(cid,0)+1/(60+rank+1)
        if cid not in merged:merged[cid]=get_card(cid)
    items=sorted(merged.values(),key=lambda c:scores.get(c['id'],0),reverse=True)[:limit]
    return {'items':items,'total':len(merged),'mode':'hybrid','indexed_count':len(indexed)}

DIST=ROOT/'apps/web/dist'
if DIST.exists():
    app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
    @app.get('/{path:path}',include_in_schema=False)
    def spa(path:str):
        if path.startswith('api/'):raise HTTPException(404)
        return FileResponse(DIST/'index.html')

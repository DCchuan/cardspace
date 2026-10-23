"""Immutable experience artifacts, explicit human grants, and local source workflows."""
import io,json,zipfile,base64,hashlib
from datetime import datetime,timedelta,timezone
from fastapi import HTTPException
from ..core import ROOT
from ..db import connect,now,uid,dumps,log
from .cards import require
from .experience_context import context,canonical,digest,freshness
from .experience_budget import configuration,estimate,ledger
from .experience_compiler import compile_source

ACTIVE=('queued','planning','generating','compiling','validating','repairing','cancel_requested','recovery_required','usage_unconfirmed')
def experience(db,card_id,mode='explainer'):
    row=db.execute('SELECT * FROM experiences WHERE card_id=?',(card_id,)).fetchone()
    if row:return dict(row)
    c=require(db,'cards',card_id);eid=uid('exp')
    db.execute('INSERT INTO experiences(id,card_id,title,mode,created_at) VALUES(?,?,?,?,?)',(eid,card_id,c['title'],mode,now()))
    return require(db,'experiences',eid)

def save_context(db,pack):
    cid=uid('ctx');db.execute('INSERT INTO experience_contexts VALUES(?,?,?,?)',(cid,canonical(pack),pack['content_fingerprint'],now()));return cid

def quote(card_id,payload,base=None):
    scope=payload.get('scope',{});pack=context(card_id,scope)
    if pack['revision_id']!=payload['expected_revision_id']:raise HTTPException(409,'卡片已变化，请重新准备演示。')
    cfg,public,fp=configuration();budget=payload['budget_policy'];budget['accounting_mode']='estimated';budget['max_repairs']=min(budget['max_repairs'],budget['max_calls']-2)
    blocked=None if cfg['allow_cloud'] and cfg['model'] else '请先在设置中配置模型，并允许所选内容外发。'
    content_chars=sum(len(x['quote']) for x in pack['refs']);guess=estimate(canonical(pack))+6000
    previous_source=None
    with connect() as db:
        if base:
            a=require(db,'experience_artifacts',base);e=require(db,'experiences',a['experience_id'])
            if e['card_id']!=card_id:raise HTTPException(422,'版本不属于本卡片。')
            previous_source=db.execute("SELECT bytes FROM experience_files WHERE artifact_id=? AND path='experience.tsx'",(base,)).fetchone()[0].decode()
        cid=save_context(db,pack);qid=uid('quote');expires=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat()
        purpose={'mode':payload.get('mode','explainer'),'goal':payload.get('goal') or '通过交互理解这张卡片的核心关系','scope':scope}
        db.execute('INSERT INTO experience_quotes VALUES(?,?,?,?,?,?,?,?,?,?)',(qid,card_id,cid,fp,canonical(purpose),canonical(budget),canonical({'low':guess,'high':guess*2}),expires,base,blocked))
    return {'quote_id':qid,'context_fingerprint':pack['content_fingerprint'],'model_config_fingerprint':fp,'model':public,'purpose':purpose,'budget_policy':budget,'token_estimate':{'low':guess,'high':guess*2},'estimate_quality':'local_estimate','accounting_mode':'estimated','price':None,'notice':'兼容服务使用估算模式；请求次数、输入字节和输出参数有上限，无法保证供应商精确计费 Token 上限。金额未知。','expires_at':expires,'blocked_reason':blocked,'content_chars':content_chars,'context':pack,'base_artifact_id':base,'previous_source':previous_source}

def generate(qid,payload,key):
    if not key or not 8<=len(key)<=128:raise HTTPException(422,'需要有效 Idempotency-Key。')
    with connect() as db:
        old=db.execute('SELECT r.* FROM experience_grants g JOIN experience_runs r ON r.grant_id=g.id WHERE g.idempotency_key=? OR g.quote_id=?',(key,qid)).fetchone()
        if old:
            q=require(db,'experience_quotes',qid)
            if require(db,'experience_grants',old['grant_id'])['quote_id']!=q['id']:raise HTTPException(409,'幂等键已用于另一个报价。')
            return {k:old[k] for k in ('id','experience_id','job_id')}|{'run_id':old['id']}
        q=require(db,'experience_quotes',qid);pack=json.loads(require(db,'experience_contexts',q['context_id'])['canonical_pack'])
        if q['expires_at']<now():raise HTTPException(409,'报价已过期，请重新准备。')
        if q['blocked_reason']:raise HTTPException(422,q['blocked_reason'])
        cfg,public,fp=configuration()
        if not cfg['allow_cloud'] or not cfg['model']:raise HTTPException(409,'模型配置已变更。')
        if fp!=q['model_config_fingerprint'] or fp!=payload['accept_model_fingerprint']:raise HTTPException(409,'模型配置已变更，请重新报价。')
        if payload['accept_budget_mode']!='estimated':raise HTTPException(422,'此服务仅支持估算预算模式。')
        if context(q['card_id'],pack['scope'])['content_fingerprint']!=pack['content_fingerprint'] or payload['accept_context_fingerprint']!=pack['content_fingerprint']:raise HTTPException(409,'资料范围已变更，请重新报价。')
        e=experience(db,q['card_id'],json.loads(q['purpose'])['mode'])
        if payload.get('base_artifact_id') not in (None,q['base_artifact_id']):raise HTTPException(409,'基准版本与报价不符。')
        if q['base_artifact_id']!=e['current_artifact_id']:raise HTTPException(409,'当前演示版本已变化，请重新报价。')
        if db.execute('SELECT 1 FROM experience_runs WHERE experience_id=? AND status IN ('+','.join('?' for _ in ACTIVE)+')',(e['id'],*ACTIVE)).fetchone():raise HTTPException(409,'已有任务，请先查看或取消。')
        gid,jid,rid=uid('grant'),uid('job'),uid('run');stamp=now()
        db.execute('INSERT INTO experience_grants VALUES(?,?,?,?,?,?)',(gid,qid,'human',q['budget_policy'],stamp,key))
        db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(jid,'experience_generate','queued',0,0,canonical({'run_id':rid}),None,None,stamp,stamp))
        db.execute('INSERT INTO experience_runs(id,experience_id,grant_id,job_id,base_artifact_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(rid,e['id'],gid,jid,q['base_artifact_id'],'queued',stamp,stamp))
        log(db,'human','experience.generate',rid,{'quote_id':qid})
        return {'experience_id':e['id'],'run_id':rid,'job_id':jid}

def artifact(db,e,context_id,source,spec,author,run_id=None,activate=False,expected=None):
    aid=uid('artifact');version=db.execute('SELECT coalesce(max(version),0)+1 FROM experience_artifacts WHERE experience_id=?',(e['id'],)).fetchone()[0]
    runtime=(ROOT/'packages/experience-runtime/trusted.js').read_bytes();rh=hashlib.sha256(runtime).hexdigest()
    report={'compiler':'experience-sdk.v1','schema_valid':True,'semantic_checks':True,'knowledge_verified':False,'notice':'编译通过不代表知识正确；请核对假设与依据。'}
    files={'experience.tsx':source.encode(),'experience.json':canonical(spec).encode()}
    manifest={'version':'artifact.v1','spec':spec,'files':{p:hashlib.sha256(b).hexdigest() for p,b in files.items()},'runtime_hash':rh,'context_id':context_id,'validation':report}
    db.execute('INSERT INTO experience_artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(aid,e['id'],version,context_id,run_id,author,'experience.v1','experience-sdk.v1',rh,canonical(manifest),canonical(report),digest(manifest),now()))
    for path,blob in files.items():db.execute('INSERT INTO experience_files VALUES(?,?,?,?,?,?)',(uid('file'),aid,path,'text/plain' if path.endswith('tsx') else 'application/json',hashlib.sha256(blob).hexdigest(),blob))
    if activate:
        changed=db.execute('UPDATE experiences SET current_artifact_id=?,title=?,mode=? WHERE id=? AND current_artifact_id IS ?',(aid,spec['title'],spec['mode'],e['id'],expected)).rowcount
        if not changed:raise HTTPException(409,'演示版本已变化，未覆盖当前版本。')
    return aid

def submit_source(card_id,source,expected_revision_id,expected_current,who='human'):
    pack=context(card_id,{'include_original_questions':False})
    if pack['revision_id']!=expected_revision_id:raise HTTPException(409,'卡片已变化。')
    refs=[x['ref_id'] for x in pack['refs']];result=compile_source(source,refs)
    if not result['spec']:raise HTTPException(422,'编译失败：'+canonical(result['diagnostics']))
    with connect() as db:
        e=experience(db,card_id,result['spec']['mode'])
        if e['current_artifact_id']!=expected_current:raise HTTPException(409,'演示版本已变化。')
        aid=artifact(db,e,save_context(db,pack),source,result['spec'],who,activate=who=='human',expected=expected_current)
        log(db,who,'experience.source.submit',aid)
    return {'experience_id':e['id'],'artifact_id':aid,'candidate':who!='human'}

def source_version(eid,source,base,who='human'):
    with connect() as db:
        e=require(db,'experiences',eid);a=require(db,'experience_artifacts',base)
        if a['experience_id']!=eid:raise HTTPException(422,'版本不属于本演示。')
        pack=json.loads(require(db,'experience_contexts',a['context_id'])['canonical_pack'])
    result=compile_source(source,[r['ref_id'] for r in pack['refs']])
    if not result['spec']:raise HTTPException(422,'编译失败：'+canonical(result['diagnostics']))
    with connect() as db:
        e=require(db,'experiences',eid)
        aid=artifact(db,e,a['context_id'],source,result['spec'],who,activate=who=='human',expected=base)
    return {'experience_id':eid,'artifact_id':aid,'candidate':who!='human'}

def details(eid):
    with connect() as db:
        e=require(db,'experiences',eid)
        e['artifacts']=[dict(r) for r in db.execute('SELECT id,version,author_type,created_at FROM experience_artifacts WHERE experience_id=? ORDER BY version DESC',(eid,))]
        r=db.execute('SELECT id FROM experience_runs WHERE experience_id=? ORDER BY created_at DESC LIMIT 1',(eid,)).fetchone()
        e['latest_run']=run(r['id']) if r else None
        e['freshness']=freshness(db,require(db,'experience_artifacts',e['current_artifact_id'])) if e['current_artifact_id'] else 'current'
        return e

def run(rid):
    with connect() as db:
        r=require(db,'experience_runs',rid);r['checkpoint']=json.loads(r['checkpoint']);r['budget']=ledger(db,rid)
        g=require(db,'experience_grants',r['grant_id']);r['budget_policy']=json.loads(g['budget_policy'])
        r['calls']=[{'phase':x['phase'],'status':x['status'],'input_reserved':x['input_reserved'],'output_reserved':x['output_reserved'],'usage':json.loads(x['actual_usage']) if x['actual_usage'] else None} for x in db.execute('SELECT * FROM generation_calls WHERE run_id=? ORDER BY started_at',(rid,))]
        return r

def cancel(rid):
    with connect() as db:
        r=require(db,'experience_runs',rid)
        if r['status'] not in ACTIVE:raise HTTPException(409,'任务已结束。')
        inflight=db.execute("SELECT 1 FROM generation_calls WHERE run_id=? AND status='in_flight' AND response_bytes IS NULL",(rid,)).fetchone()
        status='cancel_requested' if inflight and r['status'] not in ('recovery_required','usage_unconfirmed') else 'cancelled'
        db.execute('UPDATE experience_runs SET cancel_requested=1,status=?,updated_at=? WHERE id=?',(status,now(),rid))
        db.execute('UPDATE jobs SET status=?,updated_at=? WHERE id=?',(status,now(),r['job_id']))
    return {'status':status,'notice':'后续调用已停止；供应商已处理的请求仍可能计费。'}

def resume(rid,confirm):
    with connect() as db:
        r=require(db,'experience_runs',rid)
        if r['status'] not in ('recovery_required','usage_unconfirmed'):raise HTTPException(409,'请为失败任务重新报价，不能重复使用旧授权。')
        if not confirm:raise HTTPException(422,'需明确确认未确认请求可能已计费；继续会使用剩余预算。')
        cfg,public,fp=configuration();g=require(db,'experience_grants',r['grant_id']);q=require(db,'experience_quotes',g['quote_id']);pack=json.loads(require(db,'experience_contexts',q['context_id'])['canonical_pack'])
        if not cfg['allow_cloud'] or fp!=q['model_config_fingerprint'] or context(q['card_id'],pack['scope'])['content_fingerprint']!=pack['content_fingerprint']:raise HTTPException(409,'资料或模型已变化，请取消并重新报价。')
        checkpoint=json.loads(r['checkpoint']);checkpoint['confirmed_unknown_calls']=[x[0] for x in db.execute("SELECT id FROM generation_calls WHERE run_id=? AND actual_usage IS NULL",(rid,))]
        db.execute("UPDATE generation_calls SET status='unknown' WHERE run_id=? AND status='in_flight' AND response_bytes IS NULL",(rid,))
        db.execute("UPDATE experience_runs SET status='queued',checkpoint=?,updated_at=? WHERE id=?",(canonical(checkpoint),now(),rid))
        db.execute("UPDATE jobs SET status='queued' WHERE id=?",(r['job_id'],))
        log(db,'human','experience.resume',rid)
    return {'run_id':rid,'status':'queued'}

def manifest(aid):
    with connect() as db:
        a=require(db,'experience_artifacts',aid);pack=json.loads(require(db,'experience_contexts',a['context_id'])['canonical_pack']);m=json.loads(a['manifest']);m['runtime_compatible']=a['runtime_hash']==hashlib.sha256((ROOT/'packages/experience-runtime/trusted.js').read_bytes()).hexdigest();m['artifact_id']=aid;m['refs']=pack['refs'];m['created_at']=a['created_at'];m['source_revision_id']=pack['revision_id'];m['conversation_id']=pack.get('conversation_id');m['files']=[dict(x) for x in db.execute('SELECT id,path,mime,sha256 FROM experience_files WHERE artifact_id=?',(aid,))];return m

def activate(eid,aid,expected):
    with connect() as db:
        a=require(db,'experience_artifacts',aid)
        if a['experience_id']!=eid:raise HTTPException(422,'版本不属于本演示。')
        if not db.execute('UPDATE experiences SET current_artifact_id=? WHERE id=? AND current_artifact_id IS ?',(aid,eid,expected)).rowcount:raise HTTPException(409,'当前版本已变化。')
    return {'current_artifact_id':aid}

def runtime_html(extra=''):
    script=(ROOT/'packages/experience-runtime/trusted.js').read_text()+extra
    style=(ROOT/'packages/experience-runtime/style.css').read_text()
    sh=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    csp=f"default-src 'none'; script-src 'sha256-{sh}'; style-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'none'"
    return f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="{csp}"><style>{style}</style><div id="root"></div><div id="sources"></div><script>{script}</script></html>'

def export(aid,include_sources=False):
    m=manifest(aid)
    if not m['runtime_compatible']:raise HTTPException(409,'运行时版本已变更，请先在源码面板本地重新编译，再导出。')
    refs=m['refs'] if include_sources else [{k:v for k,v in r.items() if k!='quote'} for r in m['refs']]
    payload=canonical({'protocol':'experience-bridge.v1','type':'INIT','spec':m['spec'],'refs':[r['ref_id'] for r in refs],'instance_id':'offline','nonce':'offline'}).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    excerpts=canonical(refs).replace('<','\\u003c')
    bootstrap="\nconst channel=new MessageChannel();channel.port1.onmessage=e=>{if(e.data.type==='OPEN_SOURCE'){const ref="+excerpts+".find(r=>r.ref_id===e.data.payload.ref_id);const box=document.getElementById('sources');box.textContent=ref?.quote||'此离线包未包含来源摘录。';box.scrollIntoView();}};window.postMessage("+payload+",'*',[channel.port2]);"
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('index.html',runtime_html(bootstrap));z.writestr('manifest.json',canonical({k:v for k,v in m.items() if k!='refs'}));z.writestr('evidence.json',canonical(refs))
        with connect() as db:
            for f in db.execute('SELECT * FROM experience_files WHERE artifact_id=?',(aid,)):z.writestr(f['path'],f['bytes'])
        z.writestr('LICENSE',(ROOT/'LICENSE').read_bytes());z.writestr('THIRD_PARTY_NOTICES.md',(ROOT/'THIRD_PARTY_NOTICES.md').read_bytes())
        z.writestr('README.txt','离线打开 index.html，无模型请求。浏览器需支持 Web Worker。\n演示包含私人内容，请自行决定分享范围。编译通过不代表知识已核验。\n')
    return out.getvalue()

def summaries(db,card_ids):
    if not card_ids:return {}
    query="""SELECT e.*,a.context_id,ctx.canonical_pack,r.content current_content,c.conversation_id,
        (SELECT id FROM experience_runs WHERE experience_id=e.id ORDER BY created_at DESC LIMIT 1) latest_run_id
        FROM experiences e JOIN cards c ON c.id=e.card_id JOIN card_revisions r ON r.id=c.current_revision_id
        LEFT JOIN experience_artifacts a ON a.id=e.current_artifact_id LEFT JOIN experience_contexts ctx ON ctx.id=a.context_id
        WHERE e.card_id IN ("""+','.join('?' for _ in card_ids)+')'
    rows=list(db.execute(query,card_ids))
    run_ids=[r['latest_run_id'] for r in rows if r['latest_run_id']]
    runs={r['id']:r['status'] for r in db.execute('SELECT id,status FROM experience_runs WHERE id IN ('+','.join('?' for _ in run_ids)+')',run_ids)} if run_ids else {}
    result={}
    for e in rows:
        stale=False
        if e['canonical_pack']:
            pack=json.loads(e['canonical_pack'])
            body=next((r for r in pack['refs'] if r['kind']=='revision'),None)
            stale=bool(body and digest(__import__('unicodedata').normalize('NFC',e['current_content'].replace('\r\n','\n').replace('\r','\n')))!=body['quote_sha256'])
            if not body:stale=pack.get('conversation_id')!=e['conversation_id']
        result[e['card_id']]={'experience_id':e['id'],'artifact_id':e['current_artifact_id'],'run_id':e['latest_run_id'],'status':runs.get(e['latest_run_id'],'ready' if e['current_artifact_id'] else 'draft'),'freshness':'stale' if stale else 'current'}
    return result

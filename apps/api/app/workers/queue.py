"""SQLite job queue with restart recovery, cancellation and persisted scheduling."""
import json
import re
import threading
from datetime import datetime,timedelta,timezone
from difflib import SequenceMatcher
from ..db import connect,now,uid,dumps,settings,set_setting,log,LOCK
from ..services.cards import require,get_card,revision,clean_summary

STOP=threading.Event()

def enqueue(job_type,payload,actor='human'):
    with connect() as db:
        # Idempotency while queued/running; completed imports deduplicate against snapshot hashes.
        encoded=dumps(payload)
        existing=db.execute("SELECT id FROM jobs WHERE job_type=? AND input=? AND status IN ('queued','running')",(job_type,encoded)).fetchone()
        if existing:return existing['id']
        jid=uid('job');stamp=now()
        db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(jid,job_type,'queued',0,0,encoded,None,None,stamp,stamp))
        log(db,actor,'job.enqueue',jid,{'type':job_type})
        return jid

def cancelled(jid):
    with connect() as db:return require(db,'jobs',jid)['status']=='cancelled'

def progress(jid,value):
    with connect() as db:db.execute("UPDATE jobs SET progress=?,updated_at=? WHERE id=? AND status='running'",(value,now(),jid))

def run_audit(jid,payload):
    with connect() as db:
        query='SELECT c.*,r.content FROM cards c JOIN card_revisions r ON r.id=c.current_revision_id WHERE c.archived=0';params=[]
        if payload.get('card_id'):query+=' AND c.id=?';params.append(payload['card_id'])
        if payload.get('tag'):query+=' AND EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=?)';params.append(payload['tag'])
        rows=[dict(r) for r in db.execute(query+' ORDER BY coalesce(c.last_reviewed_at,c.created_at) LIMIT ?',params+[payload.get('limit',500)])]
        all_cards=[dict(r) for r in db.execute('SELECT c.id,c.title,c.summary FROM cards c WHERE archived=0 LIMIT 10000')]
    count=0
    for i,c in enumerate(rows):
        if cancelled(jid):return {'cancelled':True,'checked':i,'findings':count}
        findings=[]
        age=(datetime.now(timezone.utc)-datetime.fromisoformat(c['last_reviewed_at'] or c['created_at'])).days
        if age>180:findings.append(('outdated','warning','这条知识值得重新核实','距上次审查已超过 180 天。时间只作为复核线索，不代表内容错误。',None))
        with connect() as db:
            has_evidence=db.execute('SELECT 1 FROM evidence WHERE card_id=?',(c['id'],)).fetchone()
        if c['card_type']=='knowledge' and not has_evidence:findings.append(('evidence','warning','为关键结论补充参考来源','知识卡片尚未关联参考资料。此结果未核查内容真伪。',None))
        # Bound comparisons to candidates sharing title bigrams; cap pair work per card.
        tokens={c['title'][n:n+2] for n in range(len(c['title'])-1)}
        candidates=[o for o in all_cards if o['id']!=c['id'] and any(t in o['title'] for t in tokens)]
        for other in candidates[:100]:
            if SequenceMatcher(None,c['title']+c['summary'],other['title']+other['summary']).ratio()>.84:
                findings.append(('duplicate','warning','发现可能重复的知识','与「'+other['title']+'」文字相似，建议对比原文后建立关联。',other['id']));break
        with connect() as db:
            for typ,severity,title,description,related in findings:
                if db.execute("SELECT 1 FROM audit_findings WHERE target_id=? AND finding_type=? AND status='open'",(c['id'],typ)).fetchone():continue
                db.execute('INSERT INTO audit_findings VALUES(?,?,?,?,?,?,?,?,?,?)',(uid('finding'),jid,c['id'],typ,severity,title,description,related,'open',now()));count+=1
            db.execute('UPDATE cards SET last_reviewed_at=? WHERE id=?',(now(),c['id']))
        progress(jid,int((i+1)/max(1,len(rows))*95))
    return {'checked':len(rows),'findings':count,'method':'local_rules_v1','notice':'本地规则初筛；没有对事实或冲突进行模型核查。'}

def run_optimization(jid,payload):
    card=get_card(payload['card_id'])
    with connect() as db:
        previous=db.execute('SELECT id FROM card_revisions WHERE card_id=? AND instruction=?',(card['id'],f'job:{jid}')).fetchone()
        if previous:return {'revision_id':previous['id'],'recovered':True}
    if payload.get('use_ai'):
        from ..adapters.model import propose
        proposal,model=propose(card,payload['instruction'])
    else:
        from ..schemas import RevisionProposal
        content=re.sub(r'\n{3,}','\n\n',card['content'].strip())
        proposal=RevisionProposal(title=card['title'],summary=clean_summary(content),content=content,tags=card['tags']);model='local-format-v1'
    if cancelled(jid):return {'cancelled':True}
    with connect() as db:
        current=require(db,'cards',card['id'])
        if current['current_revision_id']!=card['current_revision_id']:raise ValueError('生成期间卡片已被修改，请重新发起整理。')
        rid=revision(db,card['id'],proposal.content,proposal.title,proposal.summary,proposal.tags,'agent','proposed',f'job:{jid}',model)
        aid=uid('approval')
        db.execute('INSERT INTO approval_requests VALUES(?,?,?,?,?,?)',(aid,'revision',card['id'],rid,'pending',now()))
    return {'revision_id':rid,'approval_id':aid,'model':model,'instruction':payload['instruction']}

def run_embeddings(jid,payload):
    from ..adapters.model import embed
    from ..services.cards import get_card
    with connect() as db:
        ids=[r[0] for r in db.execute('SELECT id FROM cards WHERE archived=0')]
    for i,cid in enumerate(ids):
        if cancelled(jid):return {'indexed':i,'cancelled':True}
        c=get_card(cid)
        vectors,model=embed([c['title']+'\n'+c['content'][:16000]])
        with connect() as db:
            if require(db,'cards',cid)['current_revision_id']==c['current_revision_id']:
                db.execute('INSERT OR REPLACE INTO embeddings VALUES(?,?,?,?)',(cid,c['current_revision_id'],model,dumps(vectors[0])))
        progress(jid,int((i+1)/max(1,len(ids))*95))
    return {'indexed':len(ids)}

def run_one():
    with connect() as db:
        row=db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not row:return False
        job=dict(row)
        db.execute("UPDATE jobs SET status='running',attempts=attempts+1,progress=5,updated_at=? WHERE id=?",(now(),job['id']))
    jid=job['id'];payload=json.loads(job['input'])
    try:
        if job['job_type']=='import':
            from ..services.imports import import_content
            result=import_content(payload,'worker')
        elif job['job_type']=='capture':
            from ..services.capture import process
            result=process(payload['capture_id'])
        elif job['job_type']=='metadata':
            from ..services.enrichment import run
            result=run(payload['card_id'])
        elif job['job_type']=='semantic-index':
            from ..services.enrichment import index
            result=index(payload['card_id'])
        elif job['job_type']=='audit':result=run_audit(jid,payload)
        elif job['job_type']=='optimization':result=run_optimization(jid,payload)
        elif job['job_type']=='embeddings':result=run_embeddings(jid,payload)
        else:raise ValueError('未知任务类型')
        with connect() as db:
            db.execute("UPDATE jobs SET status=?,progress=100,result=?,error=NULL,updated_at=? WHERE id=? AND status!='cancelled'",('partial' if result.get('capture_status')=='partial' else 'completed',dumps(result),now(),jid))
        if job['job_type']=='import':
            with connect() as db:cfg=settings(db)
            if cfg['incremental_audit']:
                for cid in result.get('card_ids',[])[:100]:enqueue('audit',{'card_id':cid,'limit':100},'scheduler')
    except Exception as exc:
        # Store bounded diagnostic text. Provider response bodies / secrets never enter logs.
        error=str(exc.detail) if hasattr(exc,'detail') else str(exc)
        with connect() as db:db.execute("UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status!='cancelled'",(error[:1200],now(),jid))
    return True

def scheduled():
    with connect() as db:cfg=settings(db)
    stamp=datetime.now(timezone.utc)
    if cfg['auto_audit'] and (not cfg['next_audit_at'] or datetime.fromisoformat(cfg['next_audit_at'])<=stamp):
        enqueue('audit',{'limit':500},'scheduler')
        with connect() as db:set_setting(db,'next_audit_at',(stamp+timedelta(days=cfg['audit_interval_days'])).isoformat())
    if not cfg['last_backup_at'] or datetime.fromisoformat(cfg['last_backup_at'])+timedelta(days=cfg['backup_interval_days'])<=stamp:
        from ..services.backup import create_backup
        create_backup('scheduler')

def loop():
    counter=0
    while not STOP.is_set():
        try:
            if counter%30==0:scheduled()
            run_one()
        except Exception:
            # A recoverable scheduler error must not kill the worker.
            import logging
            logging.getLogger('cardspace').exception('Worker tick failed')
        counter+=1
        STOP.wait(1)

def start():
    STOP.clear();thread=threading.Thread(target=loop,name='cardspace-worker',daemon=True);thread.start();return thread

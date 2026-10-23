"""Dedicated single generation lane. Persist provider responses before interpreting them."""
import json,threading,hashlib
from fastapi import HTTPException
from ..core import ROOT
from ..db import connect,now,uid
from ..services.cards import require
from ..services.experience_context import canonical,context
from ..services.experience_budget import configuration,reserve
from ..services.experience_compiler import compile_source
from ..services import experiences as store
from ..adapters import experience_model
STOP=threading.Event()

class Halt(Exception):pass

def checkpoint(rid,cp,phase):
    with connect() as db:
        r=require(db,'experience_runs',rid)
        if r['cancel_requested']:raise Halt('CANCELLED')
        db.execute('UPDATE experience_runs SET checkpoint=?,status=?,updated_at=? WHERE id=?',(canonical(cp),phase,now(),rid))
        db.execute('UPDATE jobs SET progress=?,updated_at=? WHERE id=?',({'planning':15,'generating':35,'compiling':65,'validating':85,'repairing':55}.get(phase,10),now(),r['job_id']))

def paid_call(rid,phase,messages,output_limit):
    with connect() as db:
        r=require(db,'experience_runs',rid)
        if r['cancel_requested'] or STOP.is_set():raise Halt('CANCELLED')
        g=require(db,'experience_grants',r['grant_id']);q=require(db,'experience_quotes',g['quote_id']);policy=json.loads(g['budget_policy'])
        previous=db.execute('SELECT * FROM generation_calls WHERE run_id=? AND phase=? ORDER BY attempt DESC LIMIT 1',(rid,phase)).fetchone()
        if previous and previous['response_bytes'] is not None:raw=previous['response_bytes'];cid=previous['id']
        else:
            if previous and previous['status']=='in_flight':raise Halt('RECOVERY_REQUIRED')
            cfg,public,fp=configuration()
            pack=json.loads(require(db,'experience_contexts',q['context_id'])['canonical_pack'])
            if not cfg['allow_cloud'] or fp!=q['model_config_fingerprint']:raise Halt('CONFIG_CHANGED')
            if context(q['card_id'],pack['scope'])['content_fingerprint']!=pack['content_fingerprint']:raise Halt('CONTEXT_CHANGED')
            prompt=canonical(messages);inp=reserve(db,rid,policy,prompt,output_limit)
            cid=uid('call');attempt=(previous['attempt']+1) if previous else 1
            db.execute('INSERT INTO generation_calls(id,run_id,phase,attempt,status,input_reserved,output_reserved,idempotency_key,started_at) VALUES(?,?,?,?,?,?,?,?,?)',(cid,rid,phase,attempt,'in_flight',inp,output_limit,uid('request'),now()));raw=None
    if raw is None:
        raw=experience_model.request(messages,cfg,output_limit)
        # First durable response, then usage parsing and checkpoint validation.
        with connect() as db:db.execute("UPDATE generation_calls SET response_bytes=?,response_sha256=?,status='responded',finished_at=? WHERE id=?",(raw,hashlib.sha256(raw).hexdigest(),now(),cid))
    try:response=json.loads(raw)
    except Exception as exc:raise Halt('PROVIDER_INVALID_JSON') from exc
    usage=response.get('usage',{});total=usage.get('total_tokens')
    if type(total) is int and 0<total<=10000000:
        with connect() as db:db.execute("UPDATE generation_calls SET actual_usage=?,status='settled' WHERE id=?",(canonical({'total_tokens':total,'prompt_tokens':usage.get('prompt_tokens'),'completion_tokens':usage.get('completion_tokens')}),cid))
    else:
        with connect() as db:
            db.execute("UPDATE generation_calls SET status='usage_unknown' WHERE id=?",(cid,))
            confirmed=json.loads(require(db,'experience_runs',rid)['checkpoint']).get('confirmed_unknown_calls',[])
        if cid not in confirmed:raise Halt('USAGE_UNCONFIRMED')
    with connect() as db:
        r=require(db,'experience_runs',rid)
        if r['cancel_requested']:raise Halt('CANCELLED')
        if store.ledger(db,rid)['accounted_tokens']>policy['max_total_tokens']:raise Halt('BUDGET_EXCEEDED')
    try:
        choice=response['choices'][0]
        if choice.get('finish_reason')=='length':raise Halt('OUTPUT_TRUNCATED')
        content=choice['message']['content']
        if not isinstance(content,str) or len(content.encode())>200000:raise Halt('OUTPUT_SIZE')
        return json.loads(content)
    except Halt:raise
    except Exception as exc:raise Halt('MODEL_OUTPUT_INVALID') from exc

def validate_plan(p,refs):
    if not isinstance(p,dict) or set(p)!={'supported','goal','relations','claims','missing'}:raise Halt('PLAN_SCHEMA')
    if type(p['supported']) is not bool or not isinstance(p['goal'],str) or len(p['goal'])>2000:raise Halt('PLAN_SCHEMA')
    for key in ('relations','missing'):
        if not isinstance(p[key],list) or len(p[key])>30 or any(not isinstance(x,str) or len(x)>2000 for x in p[key]):raise Halt('PLAN_SCHEMA')
    if not isinstance(p['claims'],list) or len(p['claims'])>30:raise Halt('PLAN_SCHEMA')
    for c in p['claims']:
        if not isinstance(c,dict) or set(c)!={'text','origin','source_refs'} or c['origin'] not in ('source','derived','illustration','hypothesis') or not isinstance(c['text'],str) or len(c['text'])>4000 or not isinstance(c['source_refs'],list) or any(r not in refs for r in c['source_refs']):raise Halt('PLAN_SCHEMA')
        if c['origin'] in ('source','derived') and not c['source_refs']:raise Halt('PLAN_SOURCE')
    return p

def source_from(p):
    if not isinstance(p,dict) or set(p)!={'files'} or not isinstance(p['files'],list) or len(p['files'])!=1:raise ValueError('CODE_FILES')
    f=p['files'][0]
    if not isinstance(f,dict) or set(f)!={'path','content'} or f['path']!='experience.tsx' or not isinstance(f['content'],str):raise ValueError('CODE_FILES')
    return f['content']

def process(rid):
    with connect() as db:
        r=require(db,'experience_runs',rid);g=require(db,'experience_grants',r['grant_id']);q=require(db,'experience_quotes',g['quote_id']);pack=json.loads(require(db,'experience_contexts',q['context_id'])['canonical_pack']);policy=json.loads(g['budget_policy']);purpose=json.loads(q['purpose']);cp=json.loads(r['checkpoint'])
        base_source=None
        if r['base_artifact_id']:
            base_source=db.execute("SELECT bytes FROM experience_files WHERE artifact_id=? AND path='experience.tsx'",(r['base_artifact_id'],)).fetchone()[0].decode()
    refs=[x['ref_id'] for x in pack['refs']]
    if 'plan' not in cp:
        checkpoint(rid,cp,'planning')
        plan=paid_call(rid,'plan',[{'role':'system','content':(ROOT/'packages/prompts/experience-plan.v1.md').read_text()},{'role':'user','content':canonical({'context':pack,'purpose':purpose})}],1800)
        cp['plan']=validate_plan(plan,refs)
        checkpoint(rid,cp,'planning')
    if not cp['plan']['supported'] or cp['plan']['missing'] or not cp['plan']['relations'] or not cp['plan']['claims']:raise Halt('UNSUPPORTED_SOURCE')
    if 'source' not in cp:
        checkpoint(rid,cp,'generating')
        system=(ROOT/'packages/prompts/experience-code.v1.md').read_text()+'\n'+(ROOT/'packages/experience-sdk/README.md').read_text()+'\n示例：\n'+(ROOT/'packages/experience-examples/recommendation.experience.tsx').read_text()
        system+='\n固定 Schema：'+canonical(json.loads((ROOT/'packages/experience-contracts/experience.v1.schema.json').read_text()))
        messages=[{'role':'system','content':system},{'role':'user','content':canonical({'context':pack,'purpose':purpose,'plan':cp['plan'],'base_source':base_source})}]
        result=paid_call(rid,'code',messages,5000)
        try:cp['source']=source_from(result)
        except ValueError:cp['source']='';cp['code_diagnostic']='CODE_FILES'
    for attempt in range(cp.get('repair_count',0),policy['max_repairs']+1):
        checkpoint(rid,cp,'compiling')
        result=compile_source(cp['source'],refs)
        if result['spec']:
            # A static page is not an interactive experience.
            nodes=[]
            def collect(n):nodes.append(n);[collect(x) for x in n.get('children',[])]
            collect(result['spec']['view'])
            if not any(n['kind'] in ('Slider','Toggle','Input','Select','Button') for n in nodes):result={'spec':None,'diagnostics':[{'code':'INTERACTION_REQUIRED'}]}
        if result['spec']:
            checkpoint(rid,cp,'validating')
            with connect() as db:
                rr=require(db,'experience_runs',rid)
                if rr['cancel_requested'] or STOP.is_set():raise Halt('CANCELLED')
                e=require(db,'experiences',r['experience_id'])
                aid=store.artifact(db,e,q['context_id'],cp['source'],result['spec'],'model',rid,True,r['base_artifact_id'])
                cp['artifact_id']=aid
                db.execute("UPDATE experience_runs SET status='ready',checkpoint=?,error_code=NULL,updated_at=? WHERE id=?",(canonical(cp),now(),rid))
                db.execute("UPDATE jobs SET status='completed',progress=100,result=?,updated_at=? WHERE id=?",(canonical({'artifact_id':aid}),now(),r['job_id']))
            return
        cp['diagnostics']=result['diagnostics']
        if attempt>=policy['max_repairs']:raise Halt('COMPILE_FAILED')
        checkpoint(rid,cp,'repairing')
        repaired=paid_call(rid,'repair_'+str(attempt+1),[{'role':'system','content':(ROOT/'packages/prompts/experience-code.v1.md').read_text()+'\n'+(ROOT/'packages/experience-sdk/README.md').read_text()+'\n'+(ROOT/'packages/prompts/experience-repair.v1.md').read_text()},{'role':'user','content':canonical({'context':pack,'plan':cp['plan'],'source':cp['source'],'diagnostics':cp['diagnostics']})}],5000)
        cp['source']=source_from(repaired)
        # Persist repair checkpoint so restart does not skip a paid result.
        cp['repair_count']=attempt+1

def recover(db):
    for r in db.execute("SELECT * FROM experience_runs WHERE status IN ('planning','generating','compiling','validating','repairing','cancel_requested')").fetchall():
        uncertain=db.execute("SELECT 1 FROM generation_calls WHERE run_id=? AND status='in_flight' AND response_bytes IS NULL",(r['id'],)).fetchone()
        status='cancelled' if r['cancel_requested'] else 'recovery_required' if uncertain else 'queued'
        db.execute('UPDATE experience_runs SET status=?,updated_at=? WHERE id=?',(status,now(),r['id']));db.execute('UPDATE jobs SET status=? WHERE id=?',(status,r['job_id']))

def run_one():
    with connect() as db:
        row=db.execute("SELECT * FROM experience_runs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
        if not row:return False
        rid=row['id'];db.execute("UPDATE experience_runs SET status='planning' WHERE id=?",(rid,));db.execute("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?",(row['job_id'],))
    try:process(rid)
    except Exception as exc:
        code=str(exc) if isinstance(exc,(Halt,ValueError)) else 'EXPERIENCE_FAILED'
        if isinstance(exc,HTTPException):code='LOCAL_VALIDATION_FAILED'
        with connect() as db:
            r=require(db,'experience_runs',rid)
            uncertain=db.execute("SELECT 1 FROM generation_calls WHERE run_id=? AND status='in_flight' AND response_bytes IS NULL",(rid,)).fetchone()
            status='cancelled' if r['cancel_requested'] or code=='CANCELLED' else 'recovery_required' if uncertain else 'usage_unconfirmed' if code=='USAGE_UNCONFIRMED' else 'budget_exceeded' if code=='BUDGET_EXCEEDED' else 'blocked' if code=='UNSUPPORTED_SOURCE' else 'failed'
            db.execute('UPDATE experience_runs SET status=?,error_code=?,updated_at=? WHERE id=?',(status,code[:160],now(),rid));db.execute('UPDATE jobs SET status=?,error=?,updated_at=? WHERE id=?',(status,code[:160],now(),r['job_id']))
    return True

def loop():
    while not STOP.is_set():
        try:run_one()
        except Exception:
            import logging
            logging.getLogger('cardspace').exception('Experience lane failed')
        STOP.wait(1)

def start():
    STOP.clear();t=threading.Thread(target=loop,name='cardspace-experiences',daemon=True);t.start();return t

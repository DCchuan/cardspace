"""Estimated accounting for generic compatible services; never advertise strict token guarantees."""
import json,math
from fastapi import HTTPException
from pydantic import BaseModel,Field,ConfigDict
from ..adapters import model
from ..db import connect,settings
from .experience_context import digest

class Budget(BaseModel):
    model_config=ConfigDict(extra='forbid')
    max_calls:int=Field(4,ge=2,le=4)
    max_repairs:int=Field(2,ge=0,le=2)
    max_total_tokens:int=Field(30000,ge=2000,le=100000)
    accounting_mode:str='estimated'

def configuration():
    with connect() as db:cfg=settings(db)
    public={'base_url':model.validate_base(cfg['model_base_url']),'model':cfg['model'],'allow_cloud':cfg['allow_cloud']}
    fingerprint=digest({**public,'credential_hash':digest(model.get_key() or '')})
    return cfg,public,fingerprint

def estimate(text):return math.ceil(len(text.encode('utf8'))/3)+512

def ledger(db,run_id):
    calls=[dict(r) for r in db.execute('SELECT * FROM generation_calls WHERE run_id=? ORDER BY started_at',(run_id,))]
    used=0;known=0;uncertain=False
    for c in calls:
        usage=json.loads(c['actual_usage']) if c['actual_usage'] else None
        if usage:known+=usage['total_tokens'];used+=usage['total_tokens']
        else:used+=c['input_reserved']+c['output_reserved'];uncertain=True
    return {'calls':len(calls),'accounted_tokens':used,'known_tokens':known,'has_unconfirmed_usage':uncertain,'accounting_mode':'estimated','price':None}

def reserve(db,run_id,policy,prompt,output):
    info=ledger(db,run_id);inp=estimate(prompt)
    if len(prompt.encode())>70000:raise ValueError('INPUT_SIZE')
    if info['calls']>=policy['max_calls'] or info['accounted_tokens']+inp+output>policy['max_total_tokens']:raise ValueError('BUDGET_EXCEEDED')
    return inp

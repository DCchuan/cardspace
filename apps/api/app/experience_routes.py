from typing import Literal
from fastapi import APIRouter,Depends,Header,HTTPException,Response
from pydantic import BaseModel,Field,ConfigDict
from .services import experiences as e
from .services.experience_budget import Budget
from .services.cards import require
from .db import connect

class DTO(BaseModel):model_config=ConfigDict(extra='forbid')
class Scope(DTO):
    selection:Literal['current_card']='current_card'
    include_original_questions:bool=True
    include_linked_evidence:bool=False
    memory_id:str|None=Field(None,max_length=80)
    answer_id:str|None=Field(None,max_length=80)
class Quote(DTO):
    expected_revision_id:str=Field(max_length=80)
    mode:Literal['explainer','prototype']='explainer'
    goal:str=Field('',max_length=2000)
    scope:Scope=Field(default_factory=Scope)
    budget_policy:Budget=Field(default_factory=Budget)
class Generate(DTO):
    accept_model_fingerprint:str=Field(max_length=100)
    accept_context_fingerprint:str=Field(max_length=100)
    accept_budget_mode:Literal['estimated','strict']
    base_artifact_id:str|None=Field(None,max_length=80)
class Source(DTO):
    source:str=Field(max_length=131072)
    expected_revision_id:str=Field(max_length=80)
    expected_current_artifact_id:str|None=Field(None,max_length=80)
class SourceVersion(DTO):
    source:str=Field(max_length=131072)
    base_artifact_id:str=Field(max_length=80)
class Activate(DTO):
    artifact_id:str=Field(max_length=80)
    expected_current_artifact_id:str|None=Field(None,max_length=80)
class Resume(DTO):confirm_unknown_charges:bool=False
class Export(DTO):include_sources:bool=False

def router(actor,human):
    r=APIRouter(prefix='/api/v1')
    @r.post('/cards/{card_id}/experience-quotes')
    def quote(card_id:str,payload:Quote,who=Depends(human)):
        with connect() as db:
            old=db.execute('SELECT current_artifact_id FROM experiences WHERE card_id=?',(card_id,)).fetchone()
        return e.quote(card_id,payload.model_dump(),old[0] if old else None)
    @r.post('/experience-quotes/{qid}/generate',status_code=202)
    def generate(qid:str,payload:Generate,idempotency_key:str|None=Header(None),who=Depends(human)):return e.generate(qid,payload.model_dump(),idempotency_key)
    @r.get('/cards/{card_id}/experiences')
    def listing(card_id:str,who=Depends(actor)):
        with connect() as db:
            require(db,'cards',card_id);ids=[x[0] for x in db.execute('SELECT id FROM experiences WHERE card_id=?',(card_id,))]
        return [e.details(x) for x in ids]
    @r.get('/cards/{card_id}/experience-context')
    def prepare(card_id:str,who=Depends(actor)):
        from .services.experience_context import context
        return context(card_id,{'include_original_questions':False})
    @r.post('/cards/{card_id}/experience-sources')
    def submit(card_id:str,payload:Source,who=Depends(actor)):return e.submit_source(card_id,payload.source,payload.expected_revision_id,payload.expected_current_artifact_id,who)
    @r.get('/experiences/{eid}')
    def detail(eid:str,who=Depends(actor)):return e.details(eid)
    @r.post('/experiences/{eid}/revision-quotes')
    def revision(eid:str,payload:Quote,who=Depends(human)):
        d=e.details(eid);return e.quote(d['card_id'],payload.model_dump(),d['current_artifact_id'])
    @r.post('/experiences/{eid}/source-versions')
    def source_version(eid:str,payload:SourceVersion,who=Depends(human)):return e.source_version(eid,payload.source,payload.base_artifact_id,who)
    @r.post('/experiences/{eid}/activate')
    def activate(eid:str,payload:Activate,who=Depends(human)):return e.activate(eid,payload.artifact_id,payload.expected_current_artifact_id)
    @r.get('/experience-runs/{rid}')
    def run(rid:str,who=Depends(actor)):return e.run(rid)
    @r.post('/experience-runs/{rid}/cancel')
    def cancel(rid:str,who=Depends(human)):return e.cancel(rid)
    @r.post('/experience-runs/{rid}/resume')
    def resume(rid:str,payload:Resume,who=Depends(human)):return e.resume(rid,payload.confirm_unknown_charges)
    @r.get('/experience-artifacts/{aid}/manifest')
    def manifest(aid:str,who=Depends(actor)):return e.manifest(aid)
    @r.get('/experience-artifacts/{aid}/files/{fid}')
    def file(aid:str,fid:str,who=Depends(actor)):
        with connect() as db:
            f=require(db,'experience_files',fid)
            if f['artifact_id']!=aid:raise HTTPException(404,'文件不存在')
        return Response(f['bytes'],media_type='text/plain',headers={'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="'+f['path']+'"'})
    @r.post('/experience-artifacts/{aid}/exports')
    def export(aid:str,payload:Export,who=Depends(human)):
        return Response(e.export(aid,payload.include_sources),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="cardspace-experience.zip"','X-Content-Type-Options':'nosniff'})
    @r.get('/experience-runtime')
    def runtime(who=Depends(actor)):return {'html':e.runtime_html()}
    return r

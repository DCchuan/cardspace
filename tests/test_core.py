import hashlib
import io
import json
import zipfile
import pytest
from fastapi.testclient import TestClient
from apps.api.app.main import app
from apps.api.app.db import connect,settings
from apps.api.app.workers.queue import run_one
from apps.api.app.adapters.conversations import parse_text,parse_export,validate_share_url,ImportProblem

P='/api/v1'

def note(c,text='今天学习推荐系统，召回与排序是不同的阶段。',**kw):
    r=c.post(P+'/notes',json={'content':text,**kw});assert r.status_code==200,r.text;return r.json()['card']

def job(c,endpoint,payload):
    r=c.post(P+endpoint,json=payload);assert r.status_code==202,r.text
    jid=r.json()['job_id'];assert run_one()
    result=c.get(P+'/jobs/'+jid).json();assert result['status'] in ('completed','partial'),result
    return result

def test_auth_csrf_and_agent_permissions(client,agent):
    assert TestClient(app).get(P+'/cards').status_code==401
    assert client.post(P+'/session',headers={'X-CardSpace-Client':'web','Origin':'https://evil.example'}).status_code==403
    assert client.get(P+'/cards',headers={'Host':'evil.example'}).status_code==400
    assert agent.get(P+'/settings').status_code==403
    c=note(agent)
    assert agent.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'content':'overwrite'}).status_code==403
    assert agent.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'archived':True}).status_code==403
    assert agent.post(P+'/backups').status_code==403

def test_note_dedup_version_lock_and_immutable_snapshot(client):
    c=note(client,title='推荐系统')
    duplicate=client.post(P+'/notes',json={'content':'今天学习推荐系统，召回与排序是不同的阶段。'}).json()
    assert duplicate['duplicate'] and duplicate['card']['id']==c['id']
    original=client.get(P+'/snapshots/'+c['snapshots'][0]['id']).content
    r=client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'content':'新的展示版本','title':'架构设计','tags':['架构']})
    assert r.status_code==200,r.text
    assert client.get(P+'/snapshots/'+c['snapshots'][0]['id']).content==original
    assert client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'title':'并发覆盖'}).status_code==409
    assert len(client.get(P+'/cards/'+c['id']+'/revisions').json())==2
    assert client.get(P+'/search',params={'q':'召回'}).json()['total']==1
    with connect() as db:
        with pytest.raises(Exception):db.execute('UPDATE source_snapshots SET raw=?',(b'bad',))

def test_text_parse_code_fences():
    raw='User: 什么是角色？\nAssistant: 示例：\n```txt\nUser: 这里是代码\n```\nUser: 再解释一下\nAssistant: 好的。'
    data=parse_text(raw)[0]
    assert len(data['messages'])==4
    assert 'User: 这里是代码' in data['messages'][1]['content']
    assert parse_text('我今天学习了知识管理')[0]['messages'][0]['content']=='我今天学习了知识管理'

def test_import_search_context_and_dedup(client):
    content='用户：抖音为什么会主动分配流量？\n助手：推荐系统会通过小批量流量评估视频，再扩大分发。\n用户：这和用户画像有什么关系？\n助手：用户画像参与匹配与排序。'
    result=job(client,'/imports',{'kind':'text','content':content,'title':'理解推荐分发'})
    cid=result['result']['card_ids'][0]
    c=client.get(P+'/cards/'+cid).json()
    conv=client.get(P+'/conversations/'+c['conversation_id']).json()
    assert len(conv['messages'])==4 and len(conv['memories'])==2
    hit=client.get(P+'/search',params={'q':'流量'}).json()['items'][0]
    mem=hit['matched_memories'][0]
    assert '流量' in mem['original_question']
    assert len(client.get(P+'/memories/'+mem['id']).json()['messages'])==2
    again=job(client,'/imports',{'kind':'text','content':content,'title':'理解推荐分发'})
    assert again['result']['duplicates']==1
    assert client.get(P+'/stats').json()['cards']==1
    assert client.get(P+'/search',params={'q':'从前聊过抖音分配流量吗'}).json()['total']==1
    assert client.get(P+'/search',params={'q':'zxqnonexistent'}).json()['total']==0

def export_fixture(answer='原始回答'):
    return {'id':'external-conversation','title':'分支对话','current_node':'a1','mapping':{
      'u':{'parent':None,'message':{'author':{'role':'user'},'content':{'parts':['原始问题']},'create_time':1}},
      'a1':{'parent':'u','message':{'author':{'role':'assistant'},'content':{'parts':[answer]},'create_time':2}},
      'a2':{'parent':'u','message':{'author':{'role':'assistant'},'content':{'parts':['另一个回答',{'content_type':'image_asset_pointer'}]},'create_time':3}}}}

def test_export_branch_snapshot_incremental(client):
    result=job(client,'/imports',{'kind':'json','content':json.dumps([export_fixture()])})
    assert result['status']=='partial'
    cid=result['result']['card_ids'][0];c=client.get(P+'/cards/'+cid).json()
    conv=client.get(P+'/conversations/'+c['conversation_id']).json()
    assert len(conv['messages'])==3
    assert all(m['parent_id']==conv['messages'][0]['id'] for m in conv['messages'][1:])
    result2=job(client,'/imports',{'kind':'json','content':json.dumps([export_fixture('更新后的回答')])})
    assert result2['result']['card_ids']==[cid]
    updated=client.get(P+'/cards/'+cid).json()
    assert len(updated['snapshots'])==2
    assert len(client.get(P+'/cards/'+cid+'/revisions').json())==2
    assert client.get(P+'/stats').json()['cards']==1

@pytest.mark.parametrize('url',['http://chatgpt.com/share/abc','https://127.0.0.1/share/a','https://chatgpt.com/c/private','https://chatgpt.com.evil.com/share/a','https://chatgpt.com@evil.com/share/a','https://chatgpt.com:999/share/a'])
def test_url_safety(url):
    with pytest.raises(ImportProblem):validate_share_url(url)

def test_approval_separation_and_stale_revision(client,agent):
    c=note(client,text='原始观点。\n\n\n\n第二段。')
    result=job(agent,'/optimization-jobs',{'card_id':c['id'],'use_ai':False})
    a=result['result']['approval_id']
    assert client.get(P+'/cards/'+c['id']).json()['current_revision_id']==c['current_revision_id']
    assert agent.post(P+'/approvals/'+a+'/approve').status_code==403
    assert client.post(P+'/approvals/'+a+'/approve').status_code==200
    assert client.get(P+'/cards/'+c['id']).json()['current_revision_id']!=c['current_revision_id']
    result2=job(client,'/optimization-jobs',{'card_id':c['id']})
    updated=client.get(P+'/cards/'+c['id']).json()
    assert client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':updated['current_revision_id'],'title':'后续修改'}).status_code==200
    assert client.post(P+'/approvals/'+result2['result']['approval_id']+'/approve').status_code==409

def test_audit_jobs_cancel_retry(client):
    c=note(client,text='简短的内容',card_type='knowledge')
    r=job(client,'/audit-jobs',{'card_id':c['id']})
    assert r['result']['checked']==1 and r['result']['findings']==1
    findings=client.get(P+'/findings').json()
    assert len(findings)==1
    assert client.post(P+'/findings/'+findings[0]['id']+'/resolve',json={'status':'dismissed'}).status_code==200
    assert len(client.get(P+'/findings').json())==0
    jid=client.post(P+'/audit-jobs',json={}).json()['job_id']
    assert client.post(P+'/jobs/'+jid+'/cancel').status_code==200
    assert client.get(P+'/jobs/'+jid).json()['status']=='cancelled'
    assert client.post(P+'/jobs/'+jid+'/retry').status_code==200
    assert run_one()

def test_knowledge_evidence(client):
    c=note(client,text='需要参考依据的个人观点',card_type='knowledge')
    r=client.post(P+'/knowledge-documents',files={'file':('来源.md','# 权威来源\n这是用于追溯的原始参考段落。'.encode(),'text/markdown')})
    assert r.status_code==200,r.text
    doc=client.get(P+'/knowledge-documents/'+r.json()['document_id']).json()
    assert doc['chunks'] and doc['chunks'][0]['locator'].startswith('全文')
    assert client.post(P+'/evidence',json={'card_id':c['id'],'chunk_id':doc['chunks'][0]['id'],'claim_ref':'个人观点'}).status_code==200
    assert len(client.get(P+'/cards/'+c['id']).json()['evidence'])==1
    assert client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'knowledge_status':'supported'}).status_code==422
    duplicate=client.post(P+'/knowledge-documents',files={'file':('来源.md','# 权威来源\n这是用于追溯的原始参考段落。'.encode())}).json()
    assert duplicate['duplicate']

def test_backup_real_restore_and_reject_tamper(client):
    c=note(client,text='备份前的原始内容')
    result=client.post(P+'/backups').json()
    blob=client.get(result['download_url']).content
    note(client,text='备份之后的新内容')
    assert client.get(P+'/stats').json()['cards']==2
    restored=client.post(P+'/restore',files={'file':('backup.zip',blob)})
    assert restored.status_code==200,restored.text
    assert client.get(P+'/stats').json()['cards']==1
    assert client.get(P+'/cards/'+c['id']).json()['content']=='备份前的原始内容'
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        db=z.read('cardspace.sqlite3');manifest=json.loads(z.read('manifest.json'))
    manifest['sha256']='bad';out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:z.writestr('manifest.json',json.dumps(manifest));z.writestr('cardspace.sqlite3',db)
    assert client.post(P+'/restore',files={'file':('bad.zip',out.getvalue())}).status_code==422
    assert client.get(P+'/stats').json()['cards']==1

def test_cloud_disabled_and_settings_validation(client):
    c=note(client)
    r=client.post(P+'/optimization-jobs',json={'card_id':c['id'],'use_ai':True})
    assert r.status_code==422
    assert client.patch(P+'/settings',json={'model_base_url':'http://evil.example/v1'}).status_code==422
    assert client.patch(P+'/settings',json={'model_base_url':'http://127.0.0.1:11434/v1','auto_audit':True,'audit_interval_days':30}).status_code==200

def test_archive_restore_and_history(client):
    c=note(client)
    r=client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'archived':True})
    assert r.status_code==200
    assert client.get(P+'/cards').json()['total']==0
    assert client.get(P+'/cards?archived=true').json()['total']==1
    assert client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'archived':False}).status_code==200
    updated=client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'content':'新内容'}).json()
    r=client.post(P+'/cards/'+c['id']+'/revisions/'+c['current_revision_id']+'/restore',json={'expected_revision_id':updated['current_revision_id']})
    assert r.status_code==200 and r.json()['content']==c['content']

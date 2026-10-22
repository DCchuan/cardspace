import json
from unittest.mock import patch
from .test_core import note,job,P
from apps.api.app.db import connect,init_db,settings
from apps.api.app.workers import queue
from apps.api.app.schemas import NoteInput
from apps.api.app.services.cards import create_note

def test_direct_agent_revision(client,agent):
    c=note(client)
    payload={'expected_revision_id':c['current_revision_id'],'title':'整理的标题','summary':'候选摘要','content':'保持原意的候选内容','tags':['知识']}
    r=agent.post(P+'/cards/'+c['id']+'/revisions',json=payload)
    assert r.status_code==201,r.text
    assert client.get(P+'/cards/'+c['id']).json()['content']==c['content']
    assert agent.post(P+'/approvals/'+r.json()['approval_id']+'/approve').status_code==403
    assert client.post(P+'/approvals/'+r.json()['approval_id']+'/approve').status_code==200
    assert client.get(P+'/cards/'+c['id']).json()['title']=='整理的标题'

def test_original_preserved_after_role_confirmation(client):
    raw='小明：讨论\n小红：回答'
    confirmed=[{'role':'user','content':'讨论'},{'role':'assistant','content':'回答'}]
    result=job(client,'/imports',{'kind':'text','content':raw,'confirmed_messages':confirmed})
    c=client.get(P+'/cards/'+result['result']['card_ids'][0]).json()
    assert client.get(P+'/snapshots/'+c['snapshots'][0]['id']).content.decode()==raw
    conv=client.get(P+'/conversations/'+c['conversation_id']).json()
    assert [m['role'] for m in conv['messages']]==['user','assistant']

def test_worker_recovery(client):
    c=note(client)
    jid=queue.enqueue('audit',{'card_id':c['id']})
    with connect() as db:db.execute("UPDATE jobs SET status='running',progress=50 WHERE id=?",(jid,))
    init_db()
    assert client.get(P+'/jobs/'+jid).json()['status']=='queued'
    assert queue.run_one()
    assert client.get(P+'/jobs/'+jid).json()['status']=='completed'

def test_structured_model_and_hybrid(client):
    c=note(client,title='推荐系统')
    with patch('apps.api.app.adapters.model.config',return_value={'model':'fake','embedding_model':'fake-embed','model_base_url':'https://unused.example/v1','allow_cloud':True}),patch('apps.api.app.adapters.model.request',return_value={'choices':[{'message':{'content':json.dumps({'title':'推荐架构','summary':'本地测试模型','content':'整理后的内容','tags':['推荐']})}}]}):
        result=job(client,'/optimization-jobs',{'card_id':c['id'],'use_ai':True})
        assert result['result']['model']=='fake'
    with patch('apps.api.app.adapters.model.embed',return_value=([[1.0,0.0]],'test-embed')):
        with connect() as db:db.execute('INSERT INTO embeddings VALUES(?,?,?,?)',(c['id'],c['current_revision_id'],'test-embed','[1,0]'))
        r=client.post(P+'/memory-search',json={'query':'完全不同的语义','semantic':True})
        assert r.status_code==200,r.text
        assert r.json()['mode']=='hybrid' and r.json()['items'][0]['id']==c['id']
    # A malformed provider response must never create a revision or mutate the card.
    with patch('apps.api.app.adapters.model.config',return_value={'model':'fake'}),patch('apps.api.app.adapters.model.request',return_value={'choices':[{'message':{'content':'{"title":"missing fields"}'}}]}):
        jid=queue.enqueue('optimization',{'card_id':c['id'],'instruction':'bad','use_ai':True})
        assert queue.run_one()
        assert client.get(P+'/jobs/'+jid).json()['status']=='failed'
    assert client.get(P+'/cards/'+c['id']).json()['current_revision_id']==c['current_revision_id']

def test_docx_and_pdf(client):
    import io
    from docx import Document
    from pypdf import PdfWriter
    doc=Document();doc.add_paragraph('可追溯的技术文档段落。');data=io.BytesIO();doc.save(data)
    r=client.post(P+'/knowledge-documents',files={'file':('test.docx',data.getvalue())})
    assert r.status_code==200,r.text
    assert r.json()['chunks']==1
    # A blank scanned PDF should fail clearly rather than be marked as indexed.
    writer=PdfWriter();writer.add_blank_page(width=600,height=800);out=io.BytesIO();writer.write(out)
    r=client.post(P+'/knowledge-documents',files={'file':('scan.pdf',out.getvalue())})
    assert r.status_code==422 and 'OCR' in r.json()['detail']

def test_export_exact_raw_file_is_reachable(client):
    raw='[ { "title": "无外部 ID 的对话", "messages": [{"role":"user","content":"问题"},{"role":"assistant","content":"回答"}], "extra_metadata": {"preserve":true} } ]'
    result=job(client,'/imports',{'kind':'json','content':raw})
    c=client.get(P+'/cards/'+result['result']['card_ids'][0]).json()
    snap=c['snapshots'][0]
    assert snap['original_snapshot_id']
    assert client.get(P+'/snapshots/'+snap['original_snapshot_id']).content.decode()==raw
    assert 'extra_metadata' in client.get(P+'/snapshots/'+snap['id']).content.decode()

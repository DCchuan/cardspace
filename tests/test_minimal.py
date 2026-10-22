import json
import sqlite3
from pathlib import Path
from unittest.mock import patch
import pytest
from apps.api.app.db import connect,settings,set_setting,init_db,now,uid
from apps.api.app.workers.queue import run_one
from apps.api.app.services import enrichment
from apps.api.app.services.cards import get_card
from apps.api.app.services.capture import detect
from .test_core import P,note,job


def capture(client,text=None,file=None):
    r=client.post(P+'/captures',json={'content':text}) if file is None else client.post(P+'/captures/file',files={'file':file})
    assert r.status_code==202,r.text
    cid=r.json()['id']
    assert client.get(P+'/captures/'+cid+'/raw').content==(text.encode() if file is None else file[1])
    assert run_one()
    return client.get(P+'/captures/'+cid).json()

def drain():
    for _ in range(50):
        if not run_one():return
    raise AssertionError('unexpected jobs')


def test_one_input_note_rules_and_manual_ownership(client):
    note(client,text='主题已有内容',tags=['工程'])
    r=capture(client,'工程设计记录\n保留完整正文，不必填写表单。')
    c=get_card(r['result']['card_ids'][0]);drain()
    assert c['title']=='工程设计记录' and c['tags']==['工程']
    changed=client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'title':'人工标题','tags':[]}).json()
    assert changed['field_ownership']['title']['owner']=='human'
    assert changed['field_ownership']['summary']['owner']=='rule'
    assert changed['field_ownership']['tags']['rejected']==['工程']
    enrichment.rules(c['id'])
    newer=get_card(c['id']);assert newer['title']=='人工标题' and newer['tags']==[]
    regenerated=client.post(P+'/cards/'+c['id']+'/regenerate',json={'field':'title','expected_revision_id':newer['current_revision_id']}).json()
    assert regenerated['title']=='工程设计记录'
    assert regenerated['field_ownership']['title']['owner']=='rule'
    # Explicit regeneration does not reintroduce rejected tags.
    client.post(P+'/cards/'+c['id']+'/regenerate',json={'field':'tags','expected_revision_id':regenerated['current_revision_id']})
    assert get_card(c['id'])['tags']==[]


def test_automatic_conversation_and_json_routing(client):
    raw='User: 如何保留原文？\nDeepSeek: 保存不可变快照。'
    r=capture(client,raw)
    assert r['route']=='text' and r['status']=='completed'
    c=get_card(r['result']['card_ids'][0]);assert c['source_type']=='deepseek'
    assert c['message_count']==2;drain()
    raw_json=Path('tests/fixtures/example-conversation.json').read_text()
    r=capture(client,file=('chat.txt',raw_json.encode(),'text/plain'))
    assert r['route']=='json' and r['result']['card_ids']


def test_raw_persists_on_fetch_and_parse_failures(client):
    raw='https://chat.deepseek.com/share/synthetic-example'
    with patch('apps.api.app.services.imports.fetch_share',side_effect=ValueError('连接失败')):
        r=capture(client,raw)
    assert r['status']=='failed' and '连接失败' in r['error']
    assert client.get(P+'/cards').json()['total']==0
    assert client.get(P+'/captures/'+r['id']+'/raw').content.decode()==raw
    assert client.post(P+'/captures/'+r['id']+'/retry').status_code==202
    with patch('apps.api.app.services.imports.fetch_share',side_effect=ValueError('仍不可用')):run_one()
    unsupported=capture(client,file=('bad.json',b'{"unexpected":true}','application/json'))
    assert unsupported['status']=='failed' and unsupported['route']=='unsupported_json'
    assert client.get(P+'/cards').json()['total']==0
    with connect() as db:
        with pytest.raises(sqlite3.IntegrityError):db.execute("UPDATE captures SET raw='overwrite' WHERE id=?",(r['id'],))


def test_mixed_links_preserved_and_unsupported_link_honest(client):
    mixed='https://chat.deepseek.com/share/test\n我的补充，不可以被忽略。'
    assert detect(mixed)=='note'
    r=capture(client,mixed);assert get_card(r['result']['card_ids'][0])['content']==mixed;drain()
    r=capture(client,'https://example.com/private')
    assert r['route']=='link' and r['status']=='partial'
    assert '未采集正文' in r['result']['warnings'][0]


def test_document_capture_and_contextual_reference(client):
    r=capture(client,file=('工程设计.md','工程设计：所有提交先保存原始输入。'.encode(),'text/markdown'))
    assert r['route']=='document' and r['result']['document_id']
    c=note(client,title='工程设计',text='如何保存原文？')
    candidates=client.get(P+'/cards/'+c['id']+'/reference-candidates').json()
    assert len(candidates)==1
    assert client.post(P+'/evidence',json={'card_id':c['id'],'chunk_id':candidates[0]['id']}).status_code==200
    assert get_card(c['id'])['knowledge_status']=='unverified'
    assert client.get(P+'/cards/'+c['id']+'/reference-candidates').json()==[]


def test_reimport_preserves_individual_human_fields(client):
    data={'id':'stable-conversation','title':'原始标题','messages':[{'role':'user','content':'原始问题'},{'role':'assistant','content':'第一版回答'}]}
    r=capture(client,json.dumps(data));c=get_card(r['result']['card_ids'][0]);drain()
    client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'title':'我的标题','content':'我的正文'})
    data['title']='来源新标题';data['messages'][1]['content']='来源新回答'
    r=capture(client,json.dumps(data));c2=get_card(r['result']['card_ids'][0])
    assert c2['id']==c['id'] and c2['title']=='我的标题' and c2['content']=='我的正文'
    assert '来源新回答' in str(client.get(P+'/conversations/'+c2['conversation_id']).json())


def enable(client,**extra):
    assert client.patch(P+'/settings',json={'allow_cloud':True,'model':'mock','embedding_model':'mock-embed','auto_metadata':True,'auto_semantic':True,**extra}).status_code==200


def test_late_ai_respects_manual_ownership_and_reference_validation(client):
    r=capture(client,'有原文依据的内容。');c=get_card(r['result']['card_ids'][0]);drain();enable(client)
    def delayed(*args):
        current=get_card(c['id'])
        client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':current['current_revision_id'],'title':'人类先修改了'})
        return {'choices':[{'message':{'content':json.dumps({'title':'模型标题','summary':'有原文依据','quote':'有原文依据','tags':[]})}}]}
    with patch('apps.api.app.adapters.model.request',side_effect=delayed):enrichment.run(c['id'])
    result=get_card(c['id']);assert result['title']=='人类先修改了' and result['summary']=='有原文依据'
    with patch('apps.api.app.adapters.model.request',return_value={'choices':[{'message':{'content':json.dumps({'title':'不可信','summary':'凭空增加','quote':'凭空增加','tags':[]})}}]}):
        with pytest.raises(ValueError,match='校验'):enrichment.run(c['id'])
    assert get_card(c['id'])['summary']=='有原文依据'


def test_automatic_model_scope_budget_and_agent_guard(client,agent):
    r=capture(client,'规则仍然可用');cid=r['result']['card_ids'][0]
    with patch('apps.api.app.adapters.model.request') as request:
        drain();assert not request.called
    enable(client,model_daily_calls=1)
    assert enrichment.reserve('metadata','正文')
    assert enrichment.reserve('semantic-query','查询') is None
    assert client.patch(P+'/settings',json={'model_max_input_chars':100}).status_code==200
    with connect() as db:db.execute('DELETE FROM model_usage')
    assert enrichment.reserve('metadata','字'*101) is None
    assert agent.post(P+'/cards/'+cid+'/regenerate',json={'field':'title','expected_revision_id':get_card(cid)['current_revision_id']}).status_code==403
    for field,value in [('card_type','project'),('source_label','伪造来源')]:
        assert agent.patch(P+'/cards/'+cid,json={'expected_revision_id':get_card(cid)['current_revision_id'],field:value}).status_code==403


def test_semantic_supplement_filters_cache_and_offline_fallback(client):
    a=note(client,title='记忆空间');b=note(client,title='归档内容',text='另一份独立内容')
    client.patch(P+'/cards/'+b['id'],json={'expected_revision_id':b['current_revision_id'],'archived':True})
    enable(client)
    with connect() as db:
        for c in (a,b):db.execute('INSERT INTO embeddings VALUES(?,?,?,?)',(c['id'],c['current_revision_id'],'mock-embed','[1,0]'))
    payload={'query':'缓存查询-'+uid('q'),'kind':'note','archived':False}
    with patch('apps.api.app.adapters.model.embed',return_value=([[1,0]],'mock-embed')) as embed:
        r=client.post(P+'/search/supplement',json=payload);assert [c['id'] for c in r.json()['items']]==[a['id']]
        assert client.post(P+'/search/supplement',json=payload).status_code==200
        assert embed.call_count==1
    with patch('apps.api.app.adapters.model.embed',side_effect=ValueError('离线')):
        r=client.post(P+'/search/supplement',json={'query':'另一个查询'});assert r.status_code==200 and r.json()['items']==[]
    assert client.get(P+'/cards',params={'q':'记忆'}).json()['items'][0]['id']==a['id']


def test_legacy_migration_protects_existing_fields(client):
    c=note(client)
    with connect() as db:
        db.execute('DELETE FROM schema_migrations WHERE version=2')
        db.execute('DELETE FROM field_ownership')
    init_db()
    assert all(v['owner']=='human' for v in get_card(c['id'])['field_ownership'].values())
    enrichment.rules(c['id']);assert get_card(c['id'])['title']==c['title']


def test_short_notes_are_not_maintenance_tasks(client):
    c=note(client,text='一句话')
    assert job(client,'/audit-jobs',{'card_id':c['id']})['result']['findings']==0


def test_orphan_input_and_cancel_recovery(client):
    from apps.api.app.services.capture import read
    with connect() as db:
        cid=uid('capture');stamp=now()
        db.execute('INSERT INTO captures(id,raw,actor,created_at,updated_at) VALUES(?,?,?,?,?)',(cid,b'kept after crash','human',stamp,stamp))
    init_db();r=read(cid);assert r['job_id']
    assert client.post(P+'/jobs/'+r['job_id']+'/cancel').status_code==200
    assert read(cid)['status']=='failed'
    assert client.post(P+'/captures/'+cid+'/retry').status_code==202
    run_one();assert read(cid)['status']=='completed'


def test_document_conversion_and_receipt_dismissal(client):
    r=capture(client,file=('note.md','一份参考文档'.encode(),'text/markdown'))
    converted=client.post(P+'/knowledge-documents/'+r['result']['document_id']+'/to-note')
    assert converted.status_code==200 and converted.json()['card']['content']=='一份参考文档'
    r=capture(client,'https://example.com/unsupported')
    assert r['status']=='partial'
    assert client.post(P+'/captures/'+r['id']+'/dismiss').status_code==200
    assert all(item['id']!=r['id'] for item in client.get(P+'/captures').json())
    assert client.get(P+'/captures/'+r['id']+'/raw').content==b'https://example.com/unsupported'


def test_agent_capture_never_uses_human_auto_model_scope(client,agent):
    enable(client)
    r=agent.post(P+'/captures',json={'content':'Agent 输入，不能借用用户自动处理授权。'}).json()
    with patch('apps.api.app.adapters.model.request') as request:
        drain();assert not request.called
    assert client.get(P+'/captures/'+r['id']).json()['status']=='completed'


def test_real_v1_backup_upgrades_without_overwriting_user_content(client):
    import io,hashlib,zipfile
    from apps.api.app.core import ROOT
    # Build an actual v1 schema, rather than relabelling the current schema version.
    old=sqlite3.connect(':memory:')
    old.executescript((ROOT/'migrations/001_initial.sql').read_text())
    old.execute('INSERT INTO schema_migrations VALUES(1,?)',(now(),))
    old.execute("INSERT INTO cards(id,card_type,title,summary,tags,color,created_at,updated_at) VALUES('legacy','note','旧标题','旧摘要','[]','white',?,?)",(now(),now()))
    old.execute("INSERT INTO card_revisions VALUES('legacy-rev','legacy','旧标题','旧摘要','[]','旧正文','human',NULL,'accepted',NULL,NULL,NULL,?)",(now(),))
    old.execute("UPDATE cards SET current_revision_id='legacy-rev' WHERE id='legacy'");old.commit()
    blob=old.serialize();old.close()
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as archive:
        archive.writestr('cardspace.sqlite3',blob)
        archive.writestr('manifest.json',json.dumps({'format':'cardspace-backup','version':1,'sha256':hashlib.sha256(blob).hexdigest()}))
    r=client.post(P+'/restore',files={'file':('v1.zip',data.getvalue())})
    assert r.status_code==200,r.text
    c=get_card('legacy');assert c['content']=='旧正文'
    assert all(v['owner']=='human' for v in c['field_ownership'].values())
    assert client.get(P+'/cards',params={'q':'旧正文'}).json()['items'][0]['id']=='legacy'


def test_exact_repeat_keeps_card_and_does_not_regenerate_metadata(client):
    first=capture(client,'相同原文，不重复整理。');drain()
    with connect() as db:before=db.execute('SELECT count(*) FROM jobs').fetchone()[0]
    second=capture(client,'相同原文，不重复整理。')
    assert second['result']['card_ids']==first['result']['card_ids']
    with connect() as db:assert db.execute('SELECT count(*) FROM jobs').fetchone()[0]==before+1


def test_incremental_index_scope_follows_edits_but_not_legacy_library(client):
    r=capture(client,'新录入，需要保持索引新鲜。');drain();enable(client)
    c=get_card(r['result']['card_ids'][0])
    updated=client.patch(P+'/cards/'+c['id'],json={'expected_revision_id':c['current_revision_id'],'content':'改过的原文'}).json()
    with patch('apps.api.app.adapters.model.embed',return_value=([[1,0]],'mock-embed')):
        drain()
    with connect() as db:assert db.execute('SELECT revision_id FROM embeddings WHERE card_id=?',(c['id'],)).fetchone()[0]==updated['current_revision_id']
    old=note(client,text='通过兼容 API 直接创建的旧范围卡片')
    with connect() as db:before=db.execute('SELECT count(*) FROM jobs').fetchone()[0]
    client.patch(P+'/cards/'+old['id'],json={'expected_revision_id':old['current_revision_id'],'title':'只做本地编辑'})
    with connect() as db:assert db.execute('SELECT count(*) FROM jobs').fetchone()[0]==before


def test_unknown_pasted_json_is_honestly_saved_as_note(client):
    raw='{"task":"this is not a supported conversation"}'
    r=capture(client,raw)
    assert r['status']=='partial' and r['route']=='json_note'
    c=get_card(r['result']['card_ids'][0])
    assert c['card_type']=='note' and c['content']==raw and not c['conversation_id']
    assert '普通笔记' in r['result']['warnings'][0]

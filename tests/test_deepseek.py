import copy
import io
import json
import zipfile
from pathlib import Path
from unittest.mock import patch
import httpx
import pytest
from apps.api.app.adapters.deepseek import parse_deepseek
from apps.api.app.adapters.shares import identify_share, capture_share
from apps.api.app.adapters.conversations import ImportProblem, parse_export, parse_text
from apps.api.app.services.imports import import_content
from apps.api.app.workers.queue import run_one
from .test_core import P

FIXTURE = json.loads((Path(__file__).parent/'fixtures/deepseek-share.json').read_text())
URL='https://chat.deepseek.com/share/cardspace-synthetic'
REAL_CLIENT=httpx.Client


def mock_share(monkeypatch, handler=None):
    from apps.api.app.adapters import shares
    def default(request):
        assert request.url.host == 'chat.deepseek.com'
        assert request.url.path == '/api/v0/share/content'
        assert request.url.params['share_id'] == 'cardspace-synthetic'
        assert 'authorization' not in request.headers
        return httpx.Response(200,json=FIXTURE)
    transport=httpx.MockTransport(handler or default)
    monkeypatch.setattr(shares.httpx,'Client',lambda **kwargs:REAL_CLIENT(transport=transport,**kwargs))


def test_fragments_and_thinking_are_separate():
    conv=parse_deepseek(FIXTURE)[0]
    assert conv['provider']=='deepseek' and conv['status']=='complete'
    assert len(conv['messages'])==4
    assistant=conv['messages'][1]
    assert assistant['parent_external_id']=='1'
    assert '合成思考' not in assistant['content']
    assert '合成思考' in assistant['metadata']['thinking_content']
    assert parse_export(json.dumps(FIXTURE))[0]['provider']=='deepseek'


def test_legacy_deepseek_json():
    old={'title':'旧格式','messages':[{'id':0,'role':'USER','content':'问题'},{'id':1,'parent_id':0,'role':'ASSISTANT','content':'回答','thinking_content':'思考'}]}
    c=parse_deepseek(old)[0]
    assert c['messages'][0]['external_id']=='0'
    assert c['messages'][1]['parent_external_id']=='0'
    assert c['messages'][1]['content']=='回答'
    assert c['messages'][1]['metadata']['thinking_content']=='思考'


def test_partial_files_interrupted_and_unknown_fragments():
    data=copy.deepcopy(FIXTURE)
    msg=data['data']['biz_data']['messages'][1]
    msg['status']='STOPPED'
    msg['fragments']=[{'type':'THINK','content':'只有思考'},{'type':'FILE','files':[{'file_name':'example.pdf'}]},{'type':'FUTURE_BLOCK','content':'未来内容'}]
    conv=parse_deepseek(data)[0]
    assert conv['status']=='partial' and len(conv['warnings'])>=3
    assert '只有思考' not in conv['messages'][1]['content']
    assert 'example.pdf' in conv['messages'][1]['content']


@pytest.mark.parametrize('biz_code',[1,2,3,99])
def test_deleted_or_missing_share(biz_code):
    with pytest.raises(ImportProblem):parse_deepseek({'code':0,'data':{'biz_code':biz_code,'biz_data':None}})


@pytest.mark.parametrize('url',[
    'http://chat.deepseek.com/share/a', 'https://chat.deepseek.com/a/chat/s/private',
    'https://chat.deepseek.com.evil.example/share/a', 'https://chat.deepseek.com@127.0.0.1/share/a',
    'https://chat.deepseek.com:444/share/a', 'https://chat.deepseek.com:bad/share/a',
    'https://chat.deepseek.com/api/v0/share/content?share_id=a', 'https://127.0.0.1/share/a',
])
def test_share_url_boundaries(url):
    with pytest.raises(ImportProblem):identify_share(url)


def test_redirect_does_not_leave_provider(monkeypatch):
    calls=[]
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302,headers={'Location':'http://127.0.0.1/private'})
    mock_share(monkeypatch,handler)
    with pytest.raises(ImportProblem):capture_share(URL)
    assert len(calls)==1


def test_url_to_memory_pipeline_and_idempotency(client,monkeypatch):
    mock_share(monkeypatch)
    jid=client.post(P+'/imports',json={'kind':'url','content':URL+'?utm_source=test#fragment'}).json()['job_id']
    assert run_one()
    j=client.get(P+'/jobs/'+jid).json()
    assert j['status']=='completed',j
    card=client.get(P+'/cards/'+j['result']['card_ids'][0]).json()
    assert card['source_type']=='deepseek' and card['source_uri']==URL
    assert '### DeepSeek' in card['content'] and '### ChatGPT' not in card['content']
    conv=client.get(P+'/conversations/'+card['conversation_id']).json()
    assert len(conv['memories'])==2
    assert len(conv['memories'][0]['message_ids'])==2
    assert conv['messages'][1]['metadata']['thinking_content']
    assert '合成思考' not in conv['memories'][0]['summary']
    result=client.get(P+'/search',params={'q':'原始问题','source':'deepseek'}).json()
    assert result['total']==1 and result['items'][0]['matched_memories'][0]['message_ids']
    raw=client.get(P+'/snapshots/'+card['snapshots'][0]['id']).content
    assert json.loads(raw)==FIXTURE
    repeated=import_content({'kind':'url','content':URL})
    assert repeated['duplicates']==1
    assert client.get(P+'/stats').json()['cards']==1


def test_pasted_deepseek_roles_and_provider(client):
    assert len(parse_text('User: 问题\nDeepSeek: 回答')[0]['messages'])==2
    result=import_content({'kind':'text','content':'User: 问题\nDeepSeek: 回答'})
    card=client.get(P+'/cards/'+result['card_ids'][0]).json()
    assert card['source_type']=='deepseek'


def test_provider_does_not_collide_with_chatgpt(client,monkeypatch):
    mock_share(monkeypatch)
    a=import_content({'kind':'url','content':URL})
    original={'id':'cardspace-synthetic','title':'另一个平台','messages':[{'role':'user','content':'问题'},{'role':'assistant','content':'回答'}]}
    b=import_content({'kind':'json','content':json.dumps(original),'provider':'chatgpt'})
    assert a['card_ids']!=b['card_ids']


def test_source_distribution_excludes_private_data(client,agent,tmp_path):
    from scripts.package_source import build_source_archive
    (tmp_path/'LICENSE').write_text('MIT')
    (tmp_path/'README.md').write_text('Source')
    (tmp_path/'.env').write_text('SECRET=do-not-include')
    (tmp_path/'apps').mkdir()
    (tmp_path/'apps/main.py').write_text('print("hello")')
    (tmp_path/'apps/node_modules').mkdir()
    (tmp_path/'apps/node_modules/private.json').write_text('private')
    (tmp_path/'apps/private.sqlite3').write_bytes(b'private')
    (tmp_path/'apps/private.json').write_text('private conversation')
    (tmp_path/'docs').mkdir()
    (tmp_path/'docs/PRD.md').write_text('private planning attachment')
    (tmp_path/'apps/linked.json').symlink_to(tmp_path/'.env')
    with zipfile.ZipFile(io.BytesIO(build_source_archive(tmp_path))) as z:
        assert set(z.namelist())=={'cardspace/LICENSE','cardspace/README.md','cardspace/apps/main.py'}
    assert client.get(P+'/project/license').status_code==200
    assert agent.get(P+'/project/source').status_code==403
    r=client.get(P+'/project/source')
    assert r.status_code==200
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert 'cardspace/LICENSE' in z.namelist()
        assert not any('.venv' in n or 'node_modules' in n or n.endswith('.sqlite3') or n.endswith('/.env') for n in z.namelist())


def test_mixed_provider_export_preserves_both():
    from .test_core import export_fixture
    mixed=[export_fixture(),FIXTURE['data']['biz_data']]
    parsed=parse_export(json.dumps(mixed))
    assert len(parsed)==2 and {c['provider'] for c in parsed}=={'chatgpt','deepseek'}

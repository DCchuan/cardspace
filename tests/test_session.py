from fastapi.testclient import TestClient
from unittest.mock import patch
from apps.api.app.main import app


def test_local_services_on_different_ports_do_not_overwrite_sessions():
    browser=TestClient(app,base_url='http://127.0.0.1:8765')
    production=browser.post('/api/v1/session',headers={'X-CardSpace-Client':'web'})
    assert production.status_code==200
    cookie=production.headers['set-cookie']
    assert 'cardspace_session_8765=' in cookie and 'HttpOnly' in cookie and 'SameSite=strict' in cookie
    with patch('apps.api.app.main.UI_TOKEN','isolated-service-secret'):
        other=browser.post('http://127.0.0.1:8766/api/v1/session',headers={'X-CardSpace-Client':'web'})
        assert 'cardspace_session_8766=' in other.headers['set-cookie']
        assert browser.get('http://127.0.0.1:8766/api/v1/cards').status_code==200
        assert 'isolated-service-secret' not in other.text
    assert browser.get('/api/v1/cards').status_code==200


def test_session_rejects_foreign_origins_and_legacy_cookie():
    browser=TestClient(app,base_url='http://127.0.0.1:8765')
    assert browser.post('/api/v1/session').status_code==403
    assert browser.post('/api/v1/session',headers={'X-CardSpace-Client':'web','Origin':'https://foreign.example'}).status_code==403
    assert browser.post('/api/v1/session',headers={'X-CardSpace-Client':'web','Sec-Fetch-Site':'cross-site'}).status_code==403
    from apps.api.app.core import UI_TOKEN
    browser.cookies.set('cardspace_session',UI_TOKEN)
    assert browser.get('/api/v1/settings').status_code==401

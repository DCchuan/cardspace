import os
import tempfile
from pathlib import Path
import pytest

_DATA=tempfile.TemporaryDirectory(prefix='cardspace-tests-')
os.environ['CARDSPACE_DATA_DIR']=_DATA.name
from apps.api.app.db import init_db,connect
from apps.api.app.main import app
from apps.api.app.core import AGENT_TOKEN
from fastapi.testclient import TestClient

@pytest.fixture(autouse=True)
def reset_db():
    from apps.api.app.core import DB_PATH
    for suffix in ('','-wal','-shm'):
        p=Path(str(DB_PATH)+suffix)
        if p.exists():p.unlink()
    init_db()
    yield

@pytest.fixture
def client():
    # No lifespan: deterministic queue tests call run_one directly.
    c=TestClient(app)
    r=c.post('/api/v1/session',headers={'X-CardSpace-Client':'web'})
    assert r.status_code==200
    return c

@pytest.fixture
def agent():
    return TestClient(app,headers={'Authorization':'Bearer '+AGENT_TOKEN})

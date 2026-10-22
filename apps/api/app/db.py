import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from .core import DB_PATH, ROOT

LOCK = threading.RLock()

def now():
    return datetime.now(timezone.utc).isoformat()

def uid(prefix):
    return f'{prefix}_{uuid.uuid4().hex[:16]}'

def dumps(value):
    return json.dumps(value, ensure_ascii=False)

@contextmanager
def connect():
    with LOCK:
        db = sqlite3.connect(DB_PATH, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

def init_db():
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('BEGIN IMMEDIATE;\n'+(ROOT / 'migrations/001_initial.sql').read_text()+'\nCOMMIT;')
        db.execute('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)', (now(),))
        if not db.execute('SELECT 1 FROM schema_migrations WHERE version=2').fetchone():
            db.commit()
            # Save a recoverable SQLite snapshot before upgrading an existing library.
            if db.execute('SELECT 1 FROM cards LIMIT 1').fetchone():
                from .core import BACKUP_DIR
                dest = sqlite3.connect(BACKUP_DIR / ('pre-v03-' + now().replace(':','-') + '.sqlite3'))
                try: db.backup(dest)
                finally: dest.close()
            db.executescript('BEGIN IMMEDIATE;\n'+(ROOT / 'migrations/002_minimal.sql').read_text()+'\nCOMMIT;')
            db.execute('INSERT INTO schema_migrations VALUES(2,?)',(now(),))
        defaults = {'model_base_url':'https://api.openai.com/v1', 'model':'', 'embedding_model':'', 'allow_cloud':False, 'audit_interval_days':7, 'next_audit_at':'', 'auto_audit':False, 'incremental_audit':False, 'backup_interval_days':1, 'last_backup_at':'', 'auto_metadata':False, 'auto_semantic':False, 'model_daily_calls':20, 'model_max_input_chars':16000, 'default_tag':''}
        for k,v in defaults.items():
            db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',(k,dumps(v)))
        if not db.execute("SELECT 1 FROM settings WHERE key='fts_rowids_v1'").fetchone():
            db.execute('DELETE FROM card_fts')
            from .services.cards import reindex
            for card in db.execute('SELECT id FROM cards').fetchall():reindex(db,card['id'])
            set_setting(db,'fts_rowids_v1',True)
        for c in db.execute("SELECT id,actor FROM captures WHERE status IN ('saved','processing') AND (job_id IS NULL OR job_id NOT IN (SELECT id FROM jobs))").fetchall():
            jid=uid('job');stamp=now()
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(jid,'capture','queued',0,0,dumps({'capture_id':c['id']}),None,None,stamp,stamp))
            db.execute('UPDATE captures SET job_id=? WHERE id=?',(jid,c['id']))
        # Interrupted jobs are retried. Services use transactional content hashes and idempotency.
        db.execute("UPDATE jobs SET status='queued',progress=0,error='进程重启，已恢复到队列' WHERE status IN ('running','captured','processing')")


def log(db, actor, action, target=None, detail=None):
    db.execute('INSERT INTO operation_logs VALUES(?,?,?,?,?,?)',(uid('log'),actor,action,target,dumps(detail or {}),now()))

def settings(db):
    return {r['key']:json.loads(r['value']) for r in db.execute('SELECT * FROM settings')}

def set_setting(db, key, value):
    db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(key,dumps(value)))

import hashlib
import io
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from fastapi import HTTPException
from ..core import DB_PATH,BACKUP_DIR,MAX_UPLOAD
from ..db import connect,LOCK,now,log,set_setting


def create_backup(actor='human'):
    with LOCK:
        name='cardspace-'+now().replace(':','-')+'.zip'
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp)/'cardspace.sqlite3'
            src=sqlite3.connect(DB_PATH)
            out=sqlite3.connect(dest)
            try:src.backup(out)
            finally:out.close();src.close()
            blob=dest.read_bytes()
            path=BACKUP_DIR/name
            with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
                z.writestr('cardspace.sqlite3',blob)
                z.writestr('manifest.json',json.dumps({'format':'cardspace-backup','version':1,'created_at':now(),'sha256':hashlib.sha256(blob).hexdigest()}))
        with connect() as db:
            log(db,actor,'backup.create',name)
            set_setting(db,'last_backup_at',now())
        # Retain the latest 30 automatic/manual snapshots.
        for old in sorted(BACKUP_DIR.glob('cardspace-*.zip'))[:-30]:old.unlink()
        return path

def restore_backup(blob,actor='human'):
    with LOCK:
        with connect() as db:
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running','processing')").fetchone():raise HTTPException(409,'请先等待或取消当前任务，再恢复备份。')
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                if sum(f.file_size for f in z.infolist())>512*1024*1024:raise ValueError('备份解压后超过 512MB')
                manifest=json.loads(z.read('manifest.json'));data=z.read('cardspace.sqlite3')
                if manifest.get('format')!='cardspace-backup' or manifest.get('version')!=1:raise ValueError('不支持的备份格式')
                if hashlib.sha256(data).hexdigest()!=manifest['sha256']:raise ValueError('数据库哈希校验失败')
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'restore.sqlite3';path.write_bytes(data)
                src=sqlite3.connect(path)
                try:
                    if src.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('数据库完整性检查失败')
                    if src.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('数据库外键校验失败')
                    if src.execute('SELECT max(version) FROM schema_migrations').fetchone()[0] not in (1,2):raise ValueError('数据库版本不兼容')
                    for raw,digest in src.execute('SELECT raw,hash FROM source_snapshots'):
                        if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('原始快照哈希校验失败')
                    # Verify required tables before touching the running database.
                    required=['cards','card_revisions','jobs','settings','card_fts','operation_logs','embeddings','approval_requests','knowledge_documents','knowledge_chunks','messages','conversations','evidence','audit_findings','card_links','sources','question_memories','memory_messages','snapshot_origins']
                    for table in required:src.execute(f'SELECT * FROM {table} LIMIT 0')
                    rollback=create_backup(actor)
                    dest=sqlite3.connect(DB_PATH)
                    try:src.backup(dest)
                    finally:dest.close()
                finally:src.close()
        except (ValueError,KeyError,sqlite3.Error,zipfile.BadZipFile,json.JSONDecodeError) as exc:raise HTTPException(422,'恢复校验失败：'+str(exc)) from exc
        from ..db import init_db
        init_db()  # Add backward-compatible metadata tables to older v1 backups.
        with connect() as db:
            db.execute("UPDATE jobs SET status='cancelled',error='备份恢复后需手动重试' WHERE status IN ('queued','running','processing')")
            log(db,actor,'backup.restore',None,{'rollback_backup':rollback.name})
        return {'restored':True,'rollback_backup':rollback.name}

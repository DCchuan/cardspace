"""Local configuration and authentication. No runtime data is stored in the repo."""
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if os.getenv('CARDSPACE_DATA_DIR'):
    DATA_DIR = Path(os.environ['CARDSPACE_DATA_DIR']).expanduser().resolve()
elif sys.platform == 'darwin':
    DATA_DIR = Path.home() / 'Library/Application Support/CardSpace'
else:
    DATA_DIR = Path(os.getenv('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'cardspace'
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.chmod(0o700)
DB_PATH = DATA_DIR / 'cardspace.sqlite3'
BACKUP_DIR = DATA_DIR / 'backups'
BACKUP_DIR.mkdir(exist_ok=True)

def load_token(name):
    path = DATA_DIR / name
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(secrets.token_urlsafe(36))
    path.chmod(0o600)
    return path.read_text().strip()

UI_TOKEN = load_token('session.secret')
AGENT_TOKEN = load_token('agent.token')
MAX_UPLOAD = 32 * 1024 * 1024

"""Persist first, route second. Parsing failures never lose a submitted input."""
import json
import re
from pathlib import Path
from ..db import connect,now,uid,dumps,log
from ..schemas import NoteInput
from .cards import create_note,require
from ..adapters.conversations import parse_export,parse_text,ImportProblem
from ..adapters.shares import identify_share


def submit(raw,filename=None,actor='human'):
    from ..workers.queue import enqueue
    cid=uid('capture');stamp=now()
    with connect() as db:
        db.execute('INSERT INTO captures(id,raw,filename,actor,created_at,updated_at) VALUES(?,?,?,?,?,?)',(cid,raw,filename,actor,stamp,stamp))
        log(db,actor,'capture.saved',cid)
    jid=enqueue('capture',{'capture_id':cid},actor)
    with connect() as db:db.execute('UPDATE captures SET job_id=? WHERE id=?',(jid,cid))
    return read(cid)

def read(cid):
    with connect() as db:
        c=require(db,'captures',cid);c.pop('raw')
        c['result']=json.loads(c['result']) if c['result'] else None
        c['cards']=[dict(db.execute('SELECT id,title,summary FROM cards WHERE id=?',(card_id,)).fetchone()) for card_id in (c['result'] or {}).get('card_ids',[])[:3] if db.execute('SELECT 1 FROM cards WHERE id=?',(card_id,)).fetchone()]
        return c

def detect(text,filename=None):
    ext=Path(filename or '').suffix.lower()
    if ext in ('.pdf','.docx'):return 'document'
    stripped=text.strip()
    if re.fullmatch(r'https?://\S+',stripped):
        try:identify_share(stripped);return 'url'
        except ImportProblem:return 'link'
    if stripped.startswith(('{','[')):
        try:
            parsed=parse_export(text,'auto')
            if any(m['role'] not in ('user','assistant','system','tool') for c in parsed for m in c['messages']):raise ImportProblem('消息角色不受支持')
            return 'json'
        except (ImportProblem,ValueError,TypeError,KeyError):
            if ext=='.json':return 'unsupported_json'
            if not filename:
                try:json.loads(text);return 'json_note'
                except ValueError:pass
    # The parser ignores labels inside fenced code and preserves any preamble.
    if not text.strip():raise ValueError('原始文件已保存，但没有可读取的文字。')
    parsed=parse_text(text,'')
    if any(m['role']=='user' for c in parsed for m in c['messages']) and any(m['role']=='assistant' for c in parsed for m in c['messages']):return 'text'
    if filename:return 'document' if ext in ('.md','.markdown','.txt') else 'unsupported_file'
    return 'note'

def process(cid):
    from .imports import import_content
    from .knowledge import import_document
    from .enrichment import initialize,rules
    from ..workers.queue import enqueue
    with connect() as db:
        c=require(db,'captures',cid)
        if c['status'] in ('completed','partial'):return json.loads(c['result'])
        db.execute("UPDATE captures SET status='processing',error=NULL,updated_at=? WHERE id=?",(now(),cid))
    try:
        blob=bytes(c['raw'])
        text='' if Path(c['filename'] or '').suffix.lower() in ('.pdf','.docx') else blob.decode('utf-8-sig')
        route=detect(text,c['filename'])
        with connect() as db:db.execute('UPDATE captures SET route=? WHERE id=?',(route,cid))
        if route in ('unsupported_json','unsupported_file'):raise ValueError('原始文件已保存，暂不支持此内容结构。可复制正文后重新记一下。')
        if route in ('url','json','text'):
            result=import_content({'kind':route,'provider':'auto','content':text},'capture')
        elif route=='document':
            result={**import_document(c['filename'],blob,'capture'),'card_ids':[],'capture_status':'complete'}
        else:
            note=create_note(NoteInput(content=text),'capture')
            result={'card_ids':[note['card']['id']],'duplicates':int(note['duplicate']),'capture_status':'partial' if route in ('link','json_note') else 'complete','warnings':['链接已保存；此地址未采集正文。可以粘贴原文继续构建记忆。'] if route=='link' else ['未识别到受支持的对话结构，已完整保存为普通笔记。'] if route=='json_note' else []}
        card_ids=result.get('card_ids',[])
        exact_repeat=bool(card_ids) and result.get('duplicates',0)>=len(card_ids)
        for card_id in ([] if exact_repeat else card_ids):
            with connect() as db:
                if not db.execute('SELECT 1 FROM field_ownership WHERE card_id=?',(card_id,)).fetchone():initialize(db,card_id)
            rules(card_id)
            # Only human submissions participate in the separately authorized new-capture scope.
            if c['actor']=='human' and route!='link':
                enqueue('metadata',{'card_id':card_id},'automation')
                enqueue('semantic-index',{'card_id':card_id},'automation')
        status='partial' if result.get('capture_status')=='partial' else 'completed'
        with connect() as db:
            db.execute('UPDATE captures SET status=?,result=?,updated_at=? WHERE id=?',(status,dumps(result),now(),cid))
            log(db,'worker','capture.'+status,cid)
        return result
    except Exception as exc:
        error=str(getattr(exc,'detail',exc))[:1200]
        with connect() as db:db.execute("UPDATE captures SET status='failed',error=?,updated_at=? WHERE id=?",(error,now(),cid))
        raise ValueError(error) from exc

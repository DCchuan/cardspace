"""Explicit, bounded NFC/code-point sources. No model calls or whole-library access."""
import hashlib,json,unicodedata
from fastapi import HTTPException
from ..db import connect
from .cards import require

def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256((value if isinstance(value,str) else canonical(value)).encode()).hexdigest()
def normalize(s):return unicodedata.normalize('NFC',s.replace('\r\n','\n').replace('\r','\n'))

def context(card_id,scope):
    with connect() as db:
        c=require(db,'cards',card_id);r=require(db,'card_revisions',c['current_revision_id']);refs=[];warnings=[]
        def add(kind,oid,text):
            text=normalize(text)
            if len(text)>12000:raise HTTPException(422,'所选片段过长，请缩小问题或内容范围。')
            if text.strip():refs.append({'ref_id':'s'+str(len(refs)+1),'kind':kind,'object_id':oid,'start_char':0,'end_char':len(text),'quote':text,'quote_sha256':digest(text)})
        if c['conversation_id'] and scope.get('include_original_questions',True):
            conv=require(db,'conversations',c['conversation_id'])
            if conv['capture_status']!='complete':warnings.append('原始对话可能不完整；仅使用已保存的文字。')
            mid=scope.get('memory_id')
            if mid:
                m=require(db,'question_memories',mid)
                if m['conversation_id']!=c['conversation_id']:raise HTTPException(422,'问题不属于本卡片当前对话。')
            else:
                m=db.execute('SELECT * FROM question_memories WHERE conversation_id=? ORDER BY rowid DESC LIMIT 1',(c['conversation_id'],)).fetchone()
            if not m:raise HTTPException(422,'没有可用的问答，请补充正文或选择当前正文范围。')
            messages=db.execute('SELECT m.* FROM memory_messages mm JOIN messages m ON m.id=mm.message_id WHERE mm.memory_id=? ORDER BY mm.position',(m['id'],)).fetchall()
            # A question can reference sibling answers: use one answer branch, never concatenate siblings.
            question=next((x for x in messages if x['role']=='user'),None)
            answers=[x for x in messages if x['role']=='assistant']
            answer_id=scope.get('answer_id');answer=next((x for x in answers if x['id']==answer_id),None) if answer_id else next(iter(answers),None)
            if answer_id and not answer:raise HTTPException(422,'回答不在所选问题分支。')
            if not answer:raise HTTPException(422,'所选问题没有已保存的回答。')
            if question:add('message',question['id'],question['content'])
            add('message',answer['id'],answer['content'])
            warnings.append('对话默认选择最近一个问题与一条回答分支；可调整选择。')
        else:
            if c['card_type']=='link':raise HTTPException(422,'尚未取得正文，请先补充内容。')
            add('revision',r['id'],r['content'])
        if scope.get('include_linked_evidence',False):
            for chunk in db.execute('SELECT k.* FROM evidence e JOIN knowledge_chunks k ON k.id=e.chunk_id WHERE e.card_id=? ORDER BY k.position LIMIT 5',(card_id,)):add('chunk',chunk['id'],chunk['text'])
        if not refs:raise HTTPException(422,'内容为空，请先补充内容。')
        if sum(len(x['quote']) for x in refs)>16000:raise HTTPException(422,'所选资料超过 16000 字，请缩小范围。')
        # Content fingerprint omits revision ID: title-only edits do not stale an unchanged body.
        fp=digest([{'kind':x['kind'],'text':x['quote']} for x in refs])
        return {'version':'context.v1','normalization':'nfc-lf-v1','card_id':card_id,'conversation_id':c['conversation_id'],'revision_id':r['id'],'scope':scope,'refs':refs,'warnings':warnings,'content_fingerprint':fp}

def freshness(db,artifact):
    pack=json.loads(require(db,'experience_contexts',artifact['context_id'])['canonical_pack'])
    try:return 'current' if context(pack['card_id'],pack['scope'])['content_fingerprint']==pack['content_fingerprint'] else 'stale'
    except HTTPException:return 'stale'

import hashlib
import json
import re
from fastapi import HTTPException
from ..db import connect, now, uid, dumps, log

COLORS = ['lavender','peach','sage','blue','yellow','white']
def require(db,table,id):
    # Table names are internal constants, never user input.
    row=db.execute(f'SELECT * FROM {table} WHERE id=?',(id,)).fetchone()
    if not row: raise HTTPException(404,'内容不存在')
    return dict(row)

def clean_summary(text, length=180):
    text=re.sub(r'[#*`>\[\]]','',text)
    return re.sub(r'\s+',' ',text).strip()[:length]

def snapshot(db,source_type,raw,uri=None,external_id=None):
    blob=raw.encode() if isinstance(raw,str) else raw
    digest=hashlib.sha256(blob).hexdigest()
    src=db.execute('SELECT * FROM sources WHERE source_type=? AND external_id=?',(source_type,external_id)).fetchone() if external_id else None
    if not src:
        # Exact content deduplication within each capture adapter.
        match=db.execute('SELECT s.* FROM sources s JOIN source_snapshots ss ON s.id=ss.source_id WHERE s.source_type=? AND ss.hash=?',(source_type,digest)).fetchone()
        src=match
    if src: source_id=src['id']
    else:
        source_id=uid('src')
        db.execute('INSERT INTO sources VALUES(?,?,?,?,?)',(source_id,source_type,uri,external_id,now()))
    previous=db.execute('SELECT id FROM source_snapshots WHERE source_id=? AND hash=?',(source_id,digest)).fetchone()
    if previous: return source_id,previous['id'],True
    sid=uid('snap')
    db.execute('INSERT INTO source_snapshots VALUES(?,?,?,?,?)',(sid,source_id,digest,blob,now()))
    return source_id,sid,False

def reindex(db,card_id):
    c=require(db,'cards',card_id)
    r=require(db,'card_revisions',c['current_revision_id'])
    questions='\n'.join(row[0] for row in db.execute('SELECT q.original_question FROM question_memories q JOIN conversations cv ON cv.id=q.conversation_id JOIN source_snapshots ss ON ss.id=cv.snapshot_id WHERE ss.source_id=?',(c['source_id'],)))
    raw='\n'.join(row[0] for row in db.execute('SELECT m.content FROM messages m JOIN conversations cv ON cv.id=m.conversation_id JOIN source_snapshots ss ON ss.id=cv.snapshot_id WHERE ss.source_id=? ORDER BY cv.created_at,m.position',(c['source_id'],)))
    if c['source_id']:
        # Search original personal notes even after display edits.
        original=db.execute('SELECT raw FROM source_snapshots WHERE source_id=? ORDER BY captured_at LIMIT 1',(c['source_id'],)).fetchone()
        if original and not c['conversation_id']: raw=bytes(original['raw']).decode('utf8','replace')
    fts_rowid=db.execute('SELECT rowid FROM cards WHERE id=?',(card_id,)).fetchone()[0]
    db.execute('DELETE FROM card_fts WHERE rowid=?',(fts_rowid,))
    db.execute('INSERT INTO card_fts(rowid,card_id,title,summary,content,questions) VALUES(?,?,?,?,?,?)',(fts_rowid,card_id,c['title'],c['summary'],r['content']+'\n'+raw,questions))
    db.execute('DELETE FROM embeddings WHERE card_id=?',(card_id,))

def revision(db,card_id,content,title,summary,tags,actor='human',status='accepted',instruction=None,model=None):
    c=require(db,'cards',card_id)
    previous=require(db,'card_revisions',c['current_revision_id']) if c['current_revision_id'] else None
    rid=uid('rev')
    db.execute('INSERT INTO card_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(rid,card_id,title,summary,dumps(tags),content,actor,c['current_revision_id'],status,instruction,model,'refine_note.v1' if instruction else None,now()))
    if status=='accepted':
        db.execute('UPDATE cards SET title=?,summary=?,tags=?,current_revision_id=?,updated_at=? WHERE id=?',(title,summary,dumps(tags),rid,now(),card_id))
        reindex(db,card_id)
        if actor=='human':
            from .enrichment import own
            for field,value in {'title':title,'summary':summary,'content':content,'tags':tags}.items():
                old=json.loads(previous[field]) if previous and field=='tags' else previous[field] if previous else None
                if old!=value:own(db,card_id,field,rejected=[t for t in (old or []) if t not in tags] if field=='tags' else None)
    log(db,actor,'revision.'+status,card_id,{'revision_id':rid})
    return rid

def create_card(db,title,content,tags,card_type='note',color='lavender',source_id=None,conversation_id=None,actor='human'):
    cid=uid('card'); stamp=now()
    db.execute('INSERT INTO cards(id,source_id,conversation_id,card_type,title,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(cid,source_id,conversation_id,card_type,title,color,stamp,stamp))
    revision(db,cid,content,title,clean_summary(content),tags,actor)
    from .enrichment import initialize,own
    initialize(db,cid)
    if actor=='human':
        for field in ('title','summary','content','tags','card_type'):own(db,cid,field)
    return cid

def serialize_card(db,row,detail=False):
    c=dict(row); c['tags']=json.loads(c['tags']); c['favorite']=bool(c['favorite']); c['archived']=bool(c['archived'])
    src=db.execute('SELECT source_type,uri FROM sources WHERE id=?',(c['source_id'],)).fetchone()
    c['source_type']=src['source_type'] if src else 'note'; c['source_uri']=src['uri'] if src else None
    c['message_count']=db.execute('SELECT count(*) FROM messages WHERE conversation_id=?',(c['conversation_id'],)).fetchone()[0]
    if detail:
        r=require(db,'card_revisions',c['current_revision_id']); c['content']=r['content']
        c['field_ownership']={r['field']:{**dict(r),'rejected':json.loads(r['rejected'])} for r in db.execute('SELECT * FROM field_ownership WHERE card_id=?',(c['id'],))}
        label=db.execute("SELECT detail FROM operation_logs WHERE target_id=? AND action='source.label' ORDER BY timestamp DESC LIMIT 1",(c['id'],)).fetchone()
        c['source_label']=json.loads(label[0]).get('label','') if label else ''
        c['related_cards']=[{'id':r['id'],'title':r['title']} for r in db.execute('SELECT c.id,c.title FROM card_links l JOIN cards c ON c.id=CASE WHEN l.source_card_id=? THEN l.target_card_id ELSE l.source_card_id END WHERE (l.source_card_id=? OR l.target_card_id=?) AND c.archived=0',(c['id'],c['id'],c['id']))]
        c['evidence']=[dict(r) for r in db.execute('SELECT e.*,k.text,k.locator,d.title document_title FROM evidence e JOIN knowledge_chunks k ON k.id=e.chunk_id JOIN knowledge_documents d ON d.id=k.document_id WHERE e.card_id=?',(c['id'],))]
        c['snapshots']=[dict(r) for r in db.execute('SELECT ss.id,ss.hash,ss.captured_at,o.original_snapshot_id FROM source_snapshots ss LEFT JOIN snapshot_origins o ON o.snapshot_id=ss.id WHERE ss.source_id=? ORDER BY ss.captured_at DESC',(c['source_id'],))]
    return c

def get_card(card_id):
    with connect() as db: return serialize_card(db,require(db,'cards',card_id),True)

def create_note(payload,actor='human'):
    with connect() as db:
        source_id,sid,duplicate=snapshot(db,'note',payload.content)
        existing=db.execute('SELECT id FROM cards WHERE source_id=?',(source_id,)).fetchone()
        if duplicate and existing: return {'card':serialize_card(db,require(db,'cards',existing['id']),True),'duplicate':True}
        title=payload.title.strip() or clean_summary(payload.content.split('\n')[0],60) or '未命名的思考'
        cid=create_card(db,title,payload.content,payload.tags,payload.card_type,payload.color,source_id,actor=actor)
        log(db,actor,'note.create',cid)
        return {'card':serialize_card(db,require(db,'cards',cid),True),'duplicate':False}

def update_card(card_id,payload,actor='human'):
    with connect() as db:
        c=require(db,'cards',card_id)
        if payload.expected_revision_id!=c['current_revision_id']: raise HTTPException(409,'卡片已被修改，请重新打开后再保存。')
        fields=payload.model_dump(exclude_unset=True,exclude_none=True)
        if actor!='human' and any(k in fields for k in ('title','summary','content','tags','card_type','source_label','archived','knowledge_status')):
            raise HTTPException(403,'Agent 修改内容必须提交候选修订，归档需要人工审批。')
        if any(k in fields for k in ('title','summary','content','tags')):
            r=require(db,'card_revisions',c['current_revision_id'])
            revision(db,card_id,payload.content if payload.content is not None else r['content'],payload.title or c['title'],payload.summary if payload.summary is not None else c['summary'],payload.tags if payload.tags is not None else json.loads(c['tags']),actor)
        from .enrichment import own
        if 'card_type' in fields:
            db.execute('UPDATE cards SET card_type=?,updated_at=? WHERE id=?',(fields['card_type'],now(),card_id));own(db,card_id,'card_type')
        if 'source_label' in fields:
            own(db,card_id,'source_label');log(db,actor,'source.label',card_id,{'label':fields['source_label']})
        for key in ('favorite','archived','knowledge_status'):
            if key in fields:
                if key=='knowledge_status' and fields[key]=='supported' and not db.execute("SELECT 1 FROM evidence WHERE card_id=? AND verdict='support'",(card_id,)).fetchone():
                    raise HTTPException(422,'supported 状态需要明确的支持证据；普通引用不等于证据已验证。')
                db.execute(f'UPDATE cards SET {key}=?,updated_at=? WHERE id=?',(fields[key],now(),card_id))
        log(db,actor,'card.update',card_id,{'fields':list(fields)})
        return serialize_card(db,require(db,'cards',card_id),True)

def list_cards(q='',kind='',tag='',favorite=False,archived=False,sort='updated',offset=0,limit=60,source='',days=0):
    with connect() as db:
        where=['c.archived=?']; params=[int(archived)]
        if kind: where.append('c.card_type=?');params.append(kind)
        if tag: where.append('EXISTS(SELECT 1 FROM json_each(c.tags) WHERE value=?)');params.append(tag)
        if favorite: where.append('c.favorite=1')
        if source: where.append('s.source_type=?');params.append(source)
        if days:
            from datetime import datetime,timedelta,timezone
            where.append('c.created_at>=?');params.append((datetime.now(timezone.utc)-timedelta(days=days)).isoformat())
        if q.strip():
            terms=re.findall(r'[\w\u4e00-\u9fff]+',q)[:20]
            if not terms: return {'items':[],'total':0}
            match=' OR '.join('"'+t.replace('"','""')+'"' for t in terms if len(t)>=3)
            ids=set()
            if match:
                ids.update(r[0] for r in db.execute('SELECT card_id FROM card_fts WHERE card_fts MATCH ?',(match,)))
            # CJK bigrams support short queries and natural language recall without claiming embeddings.
            short=set(t for t in terms if len(t)<3)
            for t in terms:
                if re.search(r'[\u4e00-\u9fff]',t): short.update(t[i:i+2] for i in range(len(t)-1))
            for t in list(short)[:80]:
                escaped=t.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
                ids.update(r[0] for r in db.execute("SELECT card_id FROM card_fts WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR questions LIKE ? ESCAPE '\\'", tuple(['%'+escaped+'%']*4)))
            if not ids: return {'items':[],'total':0}
            where.append('c.id IN ('+','.join('?' for _ in ids)+')');params.extend(ids)
        clause=' AND '.join(where)
        total=db.execute('SELECT count(*) FROM cards c LEFT JOIN sources s ON s.id=c.source_id WHERE '+clause,params).fetchone()[0]
        order='c.created_at DESC' if sort=='created' else 'c.title COLLATE NOCASE' if sort=='title' else 'c.updated_at DESC'
        # Relevance ranking uses source questions ahead of display text.
        if q.strip():
            rows=db.execute('SELECT c.* FROM cards c LEFT JOIN sources s ON s.id=c.source_id WHERE '+clause+' ORDER BY '+order,params).fetchall()
            terms2=terms+list(short)
            scores={}
            # Stream FTS documents once rather than scanning the virtual table once per result.
            for doc in db.execute('SELECT card_id,title,summary,content,questions FROM card_fts WHERE card_id IN ('+','.join('?' for _ in ids)+')',list(ids)):
                scores[doc['card_id']]=sum((12 if t in doc['questions'] else 0)+(8 if t in doc['title'] else 0)+(3 if t in doc['summary'] else 0)+(1 if t in doc['content'] else 0) for t in terms2)
            rows=sorted(rows,key=lambda row:scores.get(row['id'],0),reverse=True)[offset:offset+limit]
        else: rows=db.execute('SELECT c.* FROM cards c LEFT JOIN sources s ON s.id=c.source_id WHERE '+clause+' ORDER BY '+order+' LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
        items=[serialize_card(db,r) for r in rows]
        if q.strip():
            for item in items:
                memories=[dict(r) for r in db.execute('SELECT q.* FROM question_memories q JOIN conversations cv ON cv.id=q.conversation_id JOIN source_snapshots ss ON ss.id=cv.snapshot_id WHERE ss.source_id=?',(item['source_id'],))]
                for m in memories:
                    m['message_ids']=[r[0] for r in db.execute('SELECT message_id FROM memory_messages WHERE memory_id=? ORDER BY position',(m['id'],))]
                memories.sort(key=lambda m:sum(t in m['original_question'] for t in terms+list(short)),reverse=True)
                item['relevance']=scores.get(item['id'],0)
                item['matched_memories']=memories[:3];item['match_source']='question' if memories else 'card';item['search_mode']='keyword'
        return {'items':items,'total':total}

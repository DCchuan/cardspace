"""Optional semantic supplement. Keyword search never waits for a model."""
import json
import math
import threading
import time
from collections import OrderedDict
from datetime import datetime,timedelta,timezone
from ..db import connect,settings
from .cards import serialize_card
from .enrichment import reserve

CACHE=OrderedDict()
CACHE_LOCK=threading.Lock()

def supplement(payload):
    query=str(payload.get('query','')).strip()[:2000]
    if not query:return {'items':[],'mode':'keyword'}
    with connect() as db:
        cfg=settings(db)
        rows=db.execute('SELECT e.*,c.*,s.source_type FROM embeddings e JOIN cards c ON c.id=e.card_id AND c.current_revision_id=e.revision_id LEFT JOIN sources s ON s.id=c.source_id WHERE e.model=?',(cfg['embedding_model'],)).fetchall()
        signature=tuple((r['card_id'],r['revision_id']) for r in rows)
    if not cfg['auto_semantic'] or not cfg['allow_cloud'] or not rows:return {'items':[],'mode':'keyword'}
    key=(query,cfg['model_base_url'],cfg['embedding_model'],signature)
    try:
        with CACHE_LOCK:cached=CACHE.get(key)
        if cached and time.monotonic()-cached[0]<300:vector=cached[1]
        else:
            if not reserve('semantic-query',query):return {'items':[],'mode':'keyword','notice':'未在授权范围内或今日预算已用完'}
            from ..adapters.model import embed
            vectors,_=embed([query]);vector=vectors[0]
            with CACHE_LOCK:
                CACHE[key]=(time.monotonic(),vector)
                while len(CACHE)>64:CACHE.popitem(last=False)
        scored=[]
        for r in rows:
            if bool(r['archived'])!=bool(payload.get('archived',False)):continue
            if payload.get('favorite') and not r['favorite']:continue
            if any(payload.get(k) and payload[k]!=r[col] for k,col in [('kind','card_type'),('source','source_type')]):continue
            if payload.get('tag') and payload['tag'] not in json.loads(r['tags']):continue
            days=max(0,int(payload.get('days',0)))
            if days and datetime.fromisoformat(r['created_at'])<datetime.now(timezone.utc)-timedelta(days=days):continue
            v=json.loads(r['vector'])
            if len(v)!=len(vector):continue
            denom=math.sqrt(sum(x*x for x in v)*sum(x*x for x in vector))
            score=sum(a*b for a,b in zip(v,vector))/denom if denom else 0
            if score>=.2:scored.append((score,r['card_id']))
        scored.sort(reverse=True)
        with connect() as db:
            items=[]
            for score,cid in scored[:min(50,int(payload.get('limit',36)))]:
                row=db.execute('SELECT * FROM cards WHERE id=?',(cid,)).fetchone()
                c=serialize_card(db,row);c['search_mode']='semantic';items.append(c)
        return {'items':items,'mode':'semantic'}
    except Exception:
        return {'items':[],'mode':'keyword','notice':'语义服务暂不可用，继续使用本地结果'}

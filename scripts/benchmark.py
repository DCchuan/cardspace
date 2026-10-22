"""Reproducible local benchmark in a disposable directory. Never touches personal data."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
TEMP=tempfile.TemporaryDirectory(prefix='cardspace-benchmark-')
os.environ['CARDSPACE_DATA_DIR']=TEMP.name
from apps.api.app.db import init_db,connect
from apps.api.app.services.cards import create_card,list_cards
init_db()
start=time.perf_counter()
with connect() as db:
    for i in range(10000):
        create_card(db,f'知识记录 {i} — '+('推荐系统' if i%7==0 else '知识管理'),f'这是第 {i} 条记录。'+'关于思考、学习、召回、排序和知识复用的完整笔记。'*8,['技术'])
seed=time.perf_counter()-start
latencies=[]
for query in ['推荐系统','知识','不存在的关键词','召回','以前讨论过推荐系统吗']*5:
    begin=time.perf_counter();list_cards(q=query,limit=36);latencies.append((time.perf_counter()-begin)*1000)
latencies.sort()
print(json.dumps({'cards':10000,'seed_seconds':round(seed,2),'queries':len(latencies),'p50_ms':round(latencies[len(latencies)//2],2),'p95_ms':round(latencies[int(len(latencies)*.95)-1],2),'max_ms':round(max(latencies),2)},ensure_ascii=False))

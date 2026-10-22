"""Normalize capture sources into the shared conversation → memory → card pipeline."""
import json
import re
from ..db import connect, now, uid, dumps, log
from .cards import snapshot, create_card, revision, COLORS
from ..adapters.conversations import ImportProblem, parse_text, parse_export, fetch_share
from ..adapters.shares import identify_share

ASSISTANTS = {'chatgpt': 'ChatGPT', 'deepseek': 'DeepSeek', 'generic': 'AI 助手'}


def preview(payload):
    if payload.kind == 'url':
        reference = identify_share(payload.content.strip())
        if payload.provider not in ('auto', reference.provider):
            raise ImportProblem('所选平台与分享链接不一致。')
        return {'conversations': [], 'provider': reference.provider, 'message': '链接将交由后台任务读取，状态以实际采集结果为准。'}
    parsed = parse_export(payload.content, payload.provider) if payload.kind == 'json' else parse_text(payload.content, payload.title)
    return {'conversations': [{k: v for k, v in c.items() if k != '_raw_item'} for c in parsed]}


def import_content(payload, actor='human'):
    kind, content = payload['kind'], payload['content']
    uri = payload.get('source_uri')
    if kind == 'url':
        reference = identify_share(content.strip())
        raw, parsed = fetch_share(reference.url)
        uri = reference.url
    else:
        raw = content
        parsed = parse_export(content, payload.get('provider', 'auto')) if kind == 'json' else parse_text(content, payload.get('title', ''))
    if kind == 'text' and payload.get('confirmed_messages'):
        parsed[0]['messages'] = payload['confirmed_messages']
        parsed[0]['status'] = 'complete' if any(m['role'] == 'assistant' for m in payload['confirmed_messages']) else 'partial'
        parsed[0]['warnings'] = [] if parsed[0]['status'] == 'complete' else ['没有识别到助手回答。']
    for conv in parsed:
        if 'provider' not in conv:
            provider = payload.get('provider', 'auto')
            if provider == 'auto':
                if re.search(r'(?im)^\s*(?:#{1,4}\s*)?(?:\*\*)?DeepSeek(?:\*\*)?\s*[:：]', content):
                    provider = 'deepseek'
                elif re.search(r'(?im)^\s*ChatGPT\s*[:：]', content):
                    provider = 'chatgpt'
                else:
                    provider = 'generic'
            conv['provider'] = provider
    card_ids, duplicates, warnings, statuses = [], 0, [], []
    with connect() as db:
        for conv in parsed:
            if kind == 'json':
                _, export_snap, _ = snapshot(db, 'export_file', raw, uri)
                conv_raw = dumps(conv.pop('_raw_item', conv.copy()))
            else:
                conv_raw = raw
            source_type = conv['provider'] if conv['provider'] != 'generic' else 'pasted_chat'
            external = conv['external_id'] or uri or None
            source_id, sid, duplicate = snapshot(db, source_type, conv_raw, uri, external)
            if kind == 'json':
                db.execute('INSERT OR IGNORE INTO snapshot_origins VALUES(?,?)', (sid, export_snap))
            # Preserve status and warnings even on an idempotent reimport.
            warnings.extend(conv['warnings'])
            statuses.append(conv['status'])
            existing = db.execute('SELECT * FROM cards WHERE source_id=?', (source_id,)).fetchone()
            if duplicate and existing:
                card_ids.append(existing['id'])
                duplicates += 1
                continue
            cid = uid('conv')
            db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?)', (cid, sid, conv['title'], conv['external_id'], conv['status'], dumps(conv['warnings']), now()))
            mapping = {m['external_id']: uid('msg') for m in conv['messages'] if m.get('external_id')}
            stored = []
            for pos, m in enumerate(conv['messages']):
                mid = mapping.get(m.get('external_id')) or uid('msg')
                parent = mapping.get(m.get('parent_external_id'))
                db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)', (mid, cid, m.get('external_id'), parent, m['role'], m['content'], pos, now()))
                if m.get('metadata'):
                    db.execute('INSERT INTO message_metadata VALUES(?,?)', (mid, dumps(m['metadata'])))
                stored.append({**m, 'id': mid})
            has_parent_links = any(m.get('parent_external_id') for m in stored)
            children = {}
            for message in stored:
                parent = message.get('parent_external_id')
                if parent:
                    children.setdefault(parent, []).append(message)
            for i, m in enumerate(stored):
                if m['role'] != 'user':
                    continue
                refs = [m]
                if m.get('external_id') and has_parent_links:
                    refs.extend(n for n in children.get(m['external_id'], []) if n['role'] == 'assistant')
                else:
                    for nxt in stored[i + 1:]:
                        if nxt['role'] == 'user':
                            break
                        if nxt['role'] == 'assistant':
                            refs.append(nxt)
                memory_id = uid('mem')
                answer = '\n'.join(x['content'] for x in refs if x['role'] == 'assistant')
                db.execute('INSERT INTO question_memories VALUES(?,?,?,?,?)', (memory_id, cid, m['content'], m['content'], answer[:400]))
                for pos, ref in enumerate(refs):
                    db.execute('INSERT INTO memory_messages VALUES(?,?,?,?,?)', (memory_id, ref['id'], 0, len(ref['content']), pos))
            def label(message):
                return '你' if message['role'] == 'user' else ASSISTANTS.get(conv['provider'],conv['provider']) if message['role'] == 'assistant' else '系统'
            view = '\n\n'.join('### ' + label(m) + '\n\n' + m['content'] for m in stored if m.get('active', True))
            title = payload.get('title') or conv['title']
            if existing:
                card_id = existing['id']
                db.execute('UPDATE cards SET conversation_id=? WHERE id=?', (cid, card_id))
                from .enrichment import protected
                from .cards import require
                current=require(db,'card_revisions',existing['current_revision_id'])
                revision(db, card_id, current['content'] if protected(db,card_id,'content') else view,
                         existing['title'] if protected(db,card_id,'title') else title,
                         existing['summary'] if protected(db,card_id,'summary') else conv['messages'][0]['content'][:180],
                         json.loads(existing['tags']), 'import')
                from .enrichment import own
                for field in ('title','summary','content'):
                    if not protected(db,card_id,field):own(db,card_id,field,'rule','source-reimport-v1')
            else:
                card_id = create_card(db, title, view, [], 'conversation', COLORS[len(card_ids) % len(COLORS)], source_id, cid, actor)
            card_ids.append(card_id)
            log(db, actor, 'conversation.import', cid, {'snapshot_id': sid, 'provider': conv['provider'], 'message_count': len(stored), 'status': conv['status']})
    return {'card_ids': card_ids, 'imported': len(card_ids) - duplicates, 'duplicates': duplicates, 'warnings': list(dict.fromkeys(warnings)), 'capture_status': 'partial' if 'partial' in statuses else 'complete'}

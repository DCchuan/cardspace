"""DeepSeek's public share payload and message fragments, without account access."""
import json
from .conversations import ImportProblem


def is_deepseek(data):
    if not isinstance(data, (dict, list)):
        return False
    if isinstance(data, list):
        return any(is_deepseek(item) for item in data[:20])
    if data.get('provider') == 'deepseek' or 'chat_sessions' in data:
        return True
    body = data.get('data')
    if isinstance(body, dict) and 'biz_data' in body:
        return is_deepseek(body['biz_data'])
    messages = data.get('messages', [])
    if isinstance(messages, list):
        return any(isinstance(m, dict) and (
            'fragments' in m or 'thinking_content' in m or m.get('role') in ('USER', 'ASSISTANT')
        ) for m in messages[:20])
    return is_deepseek(data['conversations']) if 'conversations' in data else False


def parse_deepseek(raw, share_id=None):
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError) as exc:
        raise ImportProblem('DeepSeek 返回的内容不是有效 JSON。') from exc
    if isinstance(data, dict) and 'code' in data and 'data' in data:
        if data['code'] != 0:
            raise ImportProblem('DeepSeek 分享服务未返回成功状态，请稍后重试或使用文本导入。')
        envelope = data.get('data')
        if not isinstance(envelope, dict):
            raise ImportProblem('DeepSeek 分享数据缺失。')
        if envelope.get('biz_code') != 0:
            reason = {1: '链接不存在', 2: '链接已删除或不可访问', 3: '原始会话已删除'}.get(envelope.get('biz_code'), '分享内容不可访问')
            raise ImportProblem('DeepSeek：' + reason + '。请确认这是公开分享链接。')
        data = envelope.get('biz_data')
    if isinstance(data, dict):
        for key in ('chat_sessions', 'conversations'):
            if key in data:
                data = data[key]
                break
    entries = data if isinstance(data, list) else [data]
    conversations = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('messages'), list):
            continue
        messages, warnings, seen = [], [], set()
        for item in entry['messages']:
            if not isinstance(item, dict):
                raise ImportProblem('DeepSeek 消息结构无效，未将不完整数据记为成功。')
            role = str(item.get('role', '')).lower()
            if role == 'human':
                role = 'user'
            if role not in ('user', 'assistant', 'system', 'tool'):
                raise ImportProblem('DeepSeek 出现不支持的消息角色，请使用文本导入并确认角色。')
            message_id = item.get('message_id', item.get('id'))
            external_id = str(message_id) if message_id is not None else None
            if external_id is not None:
                if external_id in seen:
                    raise ImportProblem('DeepSeek 消息 ID 重复，无法可靠建立上下文。')
                seen.add(external_id)
            body, thinking, files = [], [], list(item.get('files') or [])
            fragments = item.get('fragments')
            if isinstance(fragments, list):
                for fragment in fragments:
                    if not isinstance(fragment, dict):
                        warnings.append('存在无法识别的消息片段，完整数据仍保存在快照中。')
                        continue
                    kind = str(fragment.get('type', '')).upper()
                    text = fragment.get('content')
                    if kind in ('REQUEST', 'RESPONSE', 'TEXT') and isinstance(text, str):
                        body.append(text)
                    elif kind in ('THINK', 'THINKING', 'REASONING') and isinstance(text, str):
                        thinking.append(text)
                    elif kind == 'FILE':
                        files.extend(fragment.get('files') or [])
                    elif kind not in ('TIP', 'TOOL_SEARCH', 'TOOL_OPEN'):
                        warnings.append('存在未识别的 DeepSeek 片段，详情请查看原始快照。')
            else:
                content = item.get('content', '')
                if isinstance(content, str) and content:
                    body.append(content)
                if isinstance(item.get('thinking_content'), str):
                    thinking.append(item['thinking_content'])
            text = '\n\n'.join(t for t in body if t.strip()).strip()
            if not text and thinking:
                text = '[此消息仅包含思考片段，未包含最终回答。]'
                warnings.append('部分消息没有最终回答；思考片段单独保留，未作为回答或结论。')
            if files:
                names = [str(f.get('file_name') or f.get('name') or '未命名附件') for f in files if isinstance(f, dict)]
                text += '\n\n[附件：' + '、'.join(names or ['未知附件']) + '；未采集二进制文件]'
                warnings.append('分享内容中的附件仅保留元数据，未下载二进制文件。')
            state = item.get('status')
            if state and str(state).upper() not in ('FINISHED', 'COMPLETED', 'SUCCESS'):
                warnings.append('部分消息状态为 ' + str(state) + '，可能没有生成完整回答。')
            if not text.strip():
                warnings.append('存在空消息，已保留在原始快照中。')
                continue
            parent = item.get('parent_id')
            message = {
                'role': role, 'content': text, 'external_id': external_id,
                'metadata': {'provider': 'deepseek', 'thinking_content': '\n\n'.join(thinking), 'attachment_count': len(files), 'original_status': state},
            }
            if parent is not None:
                message['parent_external_id'] = str(parent)
            messages.append(message)
        if not messages:
            raise ImportProblem('DeepSeek 分享中没有可导入的消息。')
        if not any(m['role'] == 'user' for m in messages) or not any(m['role'] == 'assistant' for m in messages):
            warnings.append('此快照未包含完整的用户与助手问答。')
        warnings = list(dict.fromkeys(warnings))
        title = entry.get('title')
        if not title or title == 'Shared Conversation':
            title = next((m['content'][:60] for m in messages if m['role'] == 'user'), 'DeepSeek 对话')
        conversations.append({
            '_raw_item': entry, 'provider': 'deepseek', 'title': title,
            'external_id': share_id or entry.get('id') or entry.get('chat_session_id'),
            'messages': messages, 'status': 'partial' if warnings else 'complete', 'warnings': warnings,
        })
    if not conversations:
        raise ImportProblem('未找到 DeepSeek 对话。支持公开分享数据或含 messages 的 JSON。')
    return conversations

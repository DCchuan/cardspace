"""Deterministic parsing: role labels outside fenced code and ChatGPT branch trees."""
import json
import re
import html
from urllib.parse import urlparse
import httpx

class ImportProblem(ValueError):
    pass

def text_parts(content):
    if isinstance(content,str): return content
    if not isinstance(content,dict): return ''
    parts = content.get('parts',[])
    return '\n'.join(p if isinstance(p,str) else '[附件：' + str(p.get('content_type','未知类型')) + '，未包含二进制文件]' for p in parts)

def parse_text(raw, title=''):
    messages, current, buf, fenced = [], None, [], False
    pattern = re.compile(r'^\s*(?:#{1,4}\s*)?(?:\*\*)?(User|Human|You|用户|我|Assistant|ChatGPT|DeepSeek|GPT|助手|System|系统)(?:\*\*)?(?=\s*[:：]|\s*$)\s*[:：]?\s*(.*)$',re.I)
    for line in raw.splitlines():
        if line.strip().startswith('```') or line.strip().startswith('~~~'): fenced = not fenced
        m = pattern.match(line) if not fenced else None
        if m:
            # A bare "我" at the start of prose is not a role label.
            label = m.group(1).lower()
            if label in ('我','gpt','用户','助手') and not re.match(r'^\s*(?:#{1,4}\s*)?(?:\*\*)?'+re.escape(m.group(1))+r'(?:\*\*)?(?:[:：]|\s*$)',line,re.I):
                m = None
        if m:
            if current: messages.append({'role':current,'content':'\n'.join(buf).strip()})
            elif '\n'.join(buf).strip(): messages.append({'role':'system','content':'\n'.join(buf).strip()})
            current = 'user' if m.group(1).lower() in ('user','human','you','用户','我') else 'system' if m.group(1).lower() in ('system','系统') else 'assistant'
            buf = [m.group(2)] if m.group(2) else []
        else: buf.append(line)
    if current: messages.append({'role':current,'content':'\n'.join(buf).strip()})
    if not messages:
        messages = [{'role':'user','content':raw}]
    messages = [m for m in messages if m['content']]
    has_roles = any(m['role']=='assistant' for m in messages)
    return [{'title':title or messages[0]['content'][:60], 'external_id':None, 'messages':messages, 'status':'complete' if has_roles else 'partial', 'warnings':[] if has_roles else ['未识别到完整问答角色，请在预览中确认。']}]

def parse_export(raw, provider='auto'):
    try: data = json.loads(raw)
    except (ValueError,TypeError): raise ImportProblem('文件不是有效的 JSON。请选择对话导出 JSON。')
    from .deepseek import is_deepseek, parse_deepseek
    entries = data.get('conversations') if isinstance(data,dict) and 'conversations' in data else data
    if provider == 'auto' and isinstance(entries,list) and any(is_deepseek(item) for item in entries):
        result=[]
        for item in entries:
            result.extend(parse_export(json.dumps(item,ensure_ascii=False),provider))
        return result
    if provider == 'deepseek' or (provider == 'auto' and is_deepseek(data)):
        return parse_deepseek(raw)
    if isinstance(data,dict) and 'conversations' in data: data = data['conversations']
    if isinstance(data,dict): data = [data]
    if not isinstance(data,list) or not data: raise ImportProblem('未找到对话列表。')
    result = []
    for conv in data:
        if not isinstance(conv,dict): continue
        mapping = conv.get('mapping',{})
        messages = []
        active = set()
        node_id = conv.get('current_node')
        while node_id and node_id in mapping and node_id not in active:
            active.add(node_id)
            node_id = mapping[node_id].get('parent')
        nodes = list(mapping.items()) if isinstance(mapping,dict) else []
        # Preserve every node and parent. Active branch appears first, branch positions stay recoverable.
        nodes.sort(key=lambda pair: (pair[0] not in active, ((pair[1].get('message') or {}).get('create_time') or 0)))
        for node_id,node in nodes:
            msg = node.get('message')
            if not msg: continue
            content = text_parts(msg.get('content',{}))
            if not content: continue
            messages.append({'external_id':node_id,'parent_external_id':node.get('parent'),'role':msg.get('author',{}).get('role','assistant'),'content':content,'active':node_id in active if active else True})
        if not messages and isinstance(conv.get('messages'),list):
            for msg in conv['messages']:
                if not isinstance(msg,dict): continue
                content = text_parts(msg.get('content',''))
                if content: messages.append({'role':msg.get('role','user'),'content':content,'external_id':msg.get('id')})
        if not messages: continue
        missing = any('[附件：' in m['content'] for m in messages)
        result.append({'_raw_item':conv,'provider':('chatgpt' if mapping or provider=='chatgpt' else 'generic'),'title':conv.get('title') or '导入的对话','external_id':conv.get('id') or conv.get('conversation_id'),'messages':messages,'status':'partial' if missing else 'complete','warnings':['附件未包含在 JSON 中，保留了附件占位与原始数据。'] if missing else []})
    if not result: raise ImportProblem('未找到支持的消息结构。支持 ChatGPT mapping 或 messages 数组。')
    return result

def validate_chatgpt_share_url(url):
    p=urlparse(url)
    if p.scheme!='https' or p.hostname not in ('chatgpt.com','chat.openai.com') or p.port not in (None,443) or p.username or p.password or not re.fullmatch(r'/share/[a-zA-Z0-9-]+/?',p.path):
        raise ImportProblem('仅支持 https://chatgpt.com/share/… 公开共享链接。私有对话请使用导出 JSON 或粘贴文本。')
    return url

def fetch_chatgpt_share(url):
    validate_chatgpt_share_url(url)
    with httpx.Client(timeout=25,follow_redirects=False,trust_env=False) as client:
        for _ in range(4):
            with client.stream('GET',url,headers={'User-Agent':'CardSpace/0.1 (local knowledge capture)'}) as response:
                if response.is_redirect:
                    from urllib.parse import urljoin
                    url = urljoin(url,response.headers['location']); validate_chatgpt_share_url(url); continue
                if response.status_code!=200: raise ImportProblem(f'共享页面不可访问（HTTP {response.status_code}）。请改用粘贴或 JSON 导入。')
                chunks, size = [],0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 16*1024*1024: raise ImportProblem('共享页面超过 16MB 限制。')
                    chunks.append(chunk)
                raw = b''.join(chunks).decode('utf-8','replace')
                break
        else: raise ImportProblem('共享页面重定向次数过多。')
    # Support structured snapshots. Streaming/obfuscated pages fail explicitly, never claim completeness.
    scripts = re.findall(r'<script[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>',raw,re.S)
    def find_conv(obj):
        if isinstance(obj,dict):
            if 'mapping' in obj: return obj
            for v in obj.values():
                found = find_conv(v)
                if found: return found
        elif isinstance(obj,list):
            for v in obj:
                found = find_conv(v)
                if found: return found
    for script in scripts:
        try: conv = find_conv(json.loads(html.unescape(script)))
        except ValueError: continue
        if conv: return raw,parse_export(json.dumps(conv))
    raise ImportProblem('页面未提供可解析的对话快照（可能需要登录或使用了动态页面格式）。请使用导出 JSON 或粘贴文本，不会将空页面记为成功导入。')


def validate_share_url(url):
    from .shares import identify_share
    identify_share(url)
    return url


def fetch_share(url):
    from .shares import capture_share
    return capture_share(url)

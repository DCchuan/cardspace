"""Provider registry for public share capture; all redirects remain within provider."""
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse, urljoin
import re
import httpx
from .conversations import ImportProblem, fetch_chatgpt_share
from .deepseek import parse_deepseek


@dataclass(frozen=True)
class ShareReference:
    provider: str
    share_id: str
    url: str


class ShareAdapter(Protocol):
    def capture(self, reference: ShareReference) -> tuple[str, list[dict]]: ...


def identify_share(url: str) -> ShareReference:
    try:
        p = urlparse(url)
        port = p.port
    except ValueError as exc:
        raise ImportProblem('共享链接地址格式无效。') from exc
    hosts = {'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'chat.deepseek.com': 'deepseek'}
    match = re.fullmatch(r'/share/([a-zA-Z0-9_-]{1,160})/?', p.path)
    if p.scheme != 'https' or p.hostname not in hosts or port not in (None, 443) or p.username or p.password or not match:
        raise ImportProblem('支持 ChatGPT 与 DeepSeek 的 HTTPS 公开分享链接（/share/…）。私有聊天请使用文本或 JSON 导入。')
    provider = hosts[p.hostname]
    host = 'chatgpt.com' if provider == 'chatgpt' else 'chat.deepseek.com'
    # Tracking parameters and fragments do not create duplicate identities.
    return ShareReference(provider, match.group(1), f'https://{host}/share/{match.group(1)}')


def _read_json_share(client, url, reference):
    for _ in range(4):
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname != 'chat.deepseek.com' or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.path != '/api/v0/share/content':
            raise ImportProblem('DeepSeek 分享接口发生了不受支持的重定向。')
        with client.stream('GET', url, headers={
            'Accept': 'application/json', 'User-Agent': 'CardSpace/0.2 (public share capture)',
            'Referer': reference.url, 'X-Client-Platform': 'web',
        }) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get('location', ''))
                continue
            if response.status_code != 200:
                raise ImportProblem(f'DeepSeek 分享不可访问（HTTP {response.status_code}）。可以改用文本或 JSON 导入。')
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 16 * 1024 * 1024:
                    raise ImportProblem('DeepSeek 分享数据超过 16MB 限制。')
                chunks.append(chunk)
            return b''.join(chunks).decode('utf-8-sig', 'strict')
    raise ImportProblem('DeepSeek 分享重定向次数过多。')


class DeepSeekShareAdapter:
    def capture(self, reference):
        endpoint = 'https://chat.deepseek.com/api/v0/share/content?share_id=' + reference.share_id
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            try:
                raw = _read_json_share(client, endpoint, reference)
            except (httpx.HTTPError, UnicodeError) as exc:
                raise ImportProblem('DeepSeek 分享读取失败，请稍后重试或使用文本 / JSON 导入。') from exc
        return raw, parse_deepseek(raw, reference.share_id)


class ChatGPTShareAdapter:
    def capture(self, reference):
        raw, conversations = fetch_chatgpt_share(reference.url)
        for conversation in conversations:
            conversation['provider'] = 'chatgpt'
            conversation['external_id'] = reference.share_id
        return raw, conversations


ADAPTERS: dict[str, ShareAdapter] = {'chatgpt': ChatGPTShareAdapter(), 'deepseek': DeepSeekShareAdapter()}


def capture_share(url):
    reference = identify_share(url)
    return ADAPTERS[reference.provider].capture(reference)

"""Bounded compatible chat request. No retries, redirects, or implicit model calls."""
import httpx,json
from .model import get_key,validate_base

def request(messages,cfg,output_limit):
    key=get_key();headers={'Authorization':'Bearer '+key} if key else {}
    payload={'model':cfg['model'],'messages':messages,'max_tokens':output_limit,'temperature':0.2,'response_format':{'type':'json_object'}}
    try:
        with httpx.Client(timeout=httpx.Timeout(90,connect=12),trust_env=False,follow_redirects=False) as client:
            with client.stream('POST',validate_base(cfg['model_base_url'])+'/chat/completions',json=payload,headers=headers) as response:
                if response.status_code>=400:raise ValueError('PROVIDER_HTTP_'+str(response.status_code))
                out=bytearray()
                for part in response.iter_bytes():
                    out.extend(part)
                    if len(out)>1048576:raise ValueError('PROVIDER_RESPONSE_LIMIT')
                return bytes(out)
    except httpx.TimeoutException as exc:raise ValueError('PROVIDER_TIMEOUT_UNKNOWN') from exc
    except httpx.HTTPError as exc:raise ValueError('PROVIDER_NETWORK_UNKNOWN') from exc

"""Only the maintained parser is executed; generated TSX never is."""
import json,os,shutil,subprocess,tempfile
from fastapi import HTTPException
from ..core import ROOT

def compile_source(source,refs):
    if len(source.encode())>131072:raise HTTPException(422,'SOURCE_SIZE')
    node=shutil.which('node')
    if not node:raise HTTPException(503,'需要 Node.js 22+ 编译演示。')
    payload={'sdk_version':'experience-sdk.v1','files':[{'path':'experience.tsx','content':source}],'source_ref_allowlist':refs}
    return compiler_call(payload,node)

def compiler_call(payload,node=None):
    with tempfile.TemporaryDirectory(prefix='cardspace-compiler-') as tmp:
        try:
            result=subprocess.run([node or shutil.which('node'),'--max-old-space-size=128',str(ROOT/'packages/experience-compiler/cli.mjs')],input=json.dumps(payload),text=True,capture_output=True,timeout=8,cwd=tmp,env={'PATH':os.defpath,'LANG':'en_US.UTF-8'})
            if result.returncode or len(result.stdout)>700000:raise ValueError()
            return json.loads(result.stdout)
        except (subprocess.TimeoutExpired,ValueError,OSError,TypeError) as exc:raise HTTPException(422,'COMPILER_UNAVAILABLE_OR_LIMIT') from exc

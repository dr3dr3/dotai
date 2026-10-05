"""Build pinned public-runtime bundle and synthetic profile; no Docker/session/auth use."""
import hashlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent
DOTAI=ROOT.parents[1]
RUNTIME=Path('/workspace/tmp/ai-pilot-session-python.tar')

def main():
    loader=importlib.machinery.SourceFileLoader('role',str(DOTAI/'scripts/roe-role'))
    spec=importlib.util.spec_from_loader(loader.name,loader)
    role=importlib.util.module_from_spec(spec);loader.exec_module(role)
    binary=role.resolve_codex()
    profile=role.profile(Path('/tmp/role'),Path('/tmp/role/output'),Path('/tmp/context'),
                         Path('/tmp/probe/tools/codex/codex'),Path('/tmp/auth/absent.json'))
    # Credential-free specialization: no auth file is created or granted.
    profile['filesystem']['read_file'].remove('/tmp/auth/absent.json')
    (ROOT/'profile.json').write_text(json.dumps(profile,indent=2)+'\n')
    sources={'tools/python/bin/python3':Path('/usr/bin/python3').resolve()}
    stdlib=Path('/usr/lib/python3.12')
    for p in sorted(stdlib.rglob('*')):
        if p.is_file() and not p.is_symlink() and '__pycache__' not in p.parts and p.suffix in ('.py','.so'):
            sources['tools/python/lib/python3.12/'+str(p.relative_to(stdlib))]=p
    libraries=set()
    for p in list(sources.values()):
        if p.suffix=='.so' or p==sources['tools/python/bin/python3']:
            out=subprocess.check_output(['ldd',str(p)],text=True)
            if 'not found' in out: raise RuntimeError('missing runtime dependency')
            for name in re.findall(r'(/[^\s()]+)',out): libraries.add(Path(name))
    for p in sorted(libraries):
        destination='tools/python/lib/'+p.name
        if destination in sources and sources[destination].resolve()!=p.resolve():
            raise RuntimeError('runtime library basename collision')
        sources[destination]=p.resolve()
    with tarfile.open(RUNTIME,'w') as archive:
        for name,p in sorted(sources.items()):
            data=p.read_bytes();item=tarfile.TarInfo(name);item.size=len(data)
            item.mode=0o755 if p.suffix!='.py' else 0o644;item.uid=item.gid=1000
            archive.addfile(item,io.BytesIO(data))
    schema_root=Path('/tmp/roe-codex-protocol-schema')
    schema_paths=[schema_root/'ClientRequest.json',schema_root/'ClientNotification.json',
       *[schema_root/('v2/'+n+'Params.json') for n in ('ThreadStart','ThreadRead','ThreadResume','ThreadSetName')]]
    evidence={str(p.relative_to(schema_root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in schema_paths}
    (ROOT/'protocol-evidence.json').write_text(json.dumps({'codex_version':'0.157.0','schemas':evidence},indent=2)+'\n')
    inputs=[ROOT/n for n in ('run.py','prepare.py','client.py','entry.sh','check.sh','profile.json','protocol-evidence.json')]
    inputs += [DOTAI/'scripts/roe-role',DOTAI/'scripts/roe_role_harnesses.py',DOTAI/'roles/codex-runtime.json',ROOT.parent/'nono-probe/run.py',RUNTIME,binary,Path('/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json')]
    pins={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    (ROOT/'pins.json').write_text(json.dumps(pins,indent=2)+'\n')
    print('Prepared public Python runtime, synthetic profile and pins; no live session run.')

if __name__=='__main__': main()

#!/usr/bin/env python3
"""Prepare or run a reviewed inert nono probe. Default is plan only.
Execution requires a Firstmate runtime reservation and explicit approval for
--case ptrace. This script is not itself a reservation or approval mechanism.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import uuid

IMAGE='sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54'
BINARY=Path('/home/vscode/.local/lib/roe-firstmate/nono')
DIGEST='520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9'
ROOT=Path(__file__).resolve().parent

def command(case, name):
    args=['docker','run','--rm','--pull=never','--name',name,
          '--label','net.rockofeye.purpose=nono-inert-probe',
          '--network=none','--read-only','--user=1000:1000','--cap-drop=ALL',
          '--security-opt=no-new-privileges=true','--memory=512m','--memory-swap=512m',
          '--cpus=1','--pids-limit=64','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=128m,mode=1777']
    if case=='ptrace': args+=['--cap-add=SYS_PTRACE']
    args+=['--interactive','--entrypoint','/usr/bin/timeout',IMAGE,
           '--signal=TERM','--kill-after=5s','60s','/bin/sh','-c',
           'mkdir /tmp/probe && tar -xf - -C /tmp/probe && exec /bin/sh /tmp/probe/entry.sh']
    return args

def bundle():
    binary=BINARY.read_bytes()
    if hashlib.sha256(binary).hexdigest()!=DIGEST:
        raise ValueError('installed nono binary changed; review and re-pin before executing')
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w') as archive:
        for name,data,mode in [('nono',binary,0o755),*[(n,(ROOT/n).read_bytes(),0o644) for n in ('profile.json','check.sh','entry.sh')]]:
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=mode
            info.uid=1000;info.gid=1000
            archive.addfile(info,io.BytesIO(data))
    return stream.getvalue()

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--case',choices=['baseline','ptrace'],default='baseline')
    ap.add_argument('--execute',action='store_true')
    a=ap.parse_args()
    name='roe-nono-probe-'+uuid.uuid4().hex[:12]
    cmd=command(a.case,name)
    print(json.dumps({'case':a.case,'container':name,'command':cmd,'executing':a.execute}),flush=True)
    if not a.execute: return 0
    data=bundle()
    # No parent environment or credentials are passed into the container.
    # The inner timeout bounds execution even if the Docker client disconnects.
    try:
        return subprocess.run(cmd,input=data,timeout=75).returncode
    except subprocess.TimeoutExpired:
        print('Docker client timed out. Inspect the printed exact container name through the reservation; do not broadly clean up.')
        return 124

if __name__=='__main__':
    raise SystemExit(main())

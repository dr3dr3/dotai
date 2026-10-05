#!/usr/bin/env python3
"""Inert HTTPS/network test; default prints the plan. Human executes under reservation."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import uuid

ROOT = Path(__file__).resolve().parent
POLICY = Path('/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--execute', action='store_true')
    args = ap.parse_args()
    pins = json.loads((ROOT / 'pins.json').read_text())
    for path, digest in pins.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'Pinned input changed: {path}')
    spec = importlib.util.spec_from_file_location('probe', ROOT.parent / 'nono-probe/run.py')
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)
    binary = probe.BINARY.read_bytes()
    if hashlib.sha256(binary).hexdigest() != probe.DIGEST:
        raise RuntimeError('nono binary changed')
    name = 'roe-nono-probe-' + uuid.uuid4().hex[:12]
    command = probe.command('baseline', name)
    command[command.index('--network=none')] = '--network=bridge'
    command[2:2] = ['--security-opt', 'seccomp=' + str(POLICY)]
    print(json.dumps({'executing': args.execute, 'container': name, 'command': command}), flush=True)
    if not args.execute:
        return 0
    if not os.environ.get('ROE_RUNTIME_TOKEN'):
        raise RuntimeError('Use the registered Firstmate reservation')
    server = json.loads(subprocess.check_output(['docker', 'version', '--format', '{{json .Server}}'], text=True, timeout=15))
    if (server['Version'], server['GitCommit'], server['Arch']) != ('29.4.0', 'daa0cb7f', 'arm64'):
        raise RuntimeError('Engine changed; review policy first')
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        files = [('nono', binary, 0o755)]
        for filename, source in json.loads((ROOT/'bundle.json').read_text()).items():
            if Path(filename).is_absolute() or '..' in Path(filename).parts:
                raise RuntimeError('Unsafe archive path')
            files.append((filename, Path(source).read_bytes(), 0o755 if filename in ('curl','network-probe') or filename.startswith('lib/') else 0o644))
        for filename, data, mode in files:
            item = tarfile.TarInfo(filename)
            item.size = len(data); item.mode = mode; item.uid = 1000; item.gid = 1000
            archive.addfile(item, io.BytesIO(data))
    try:
        result = subprocess.run(command, input=stream.getvalue(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=75)
    except subprocess.TimeoutExpired:
        print(f'STOP: timeout; inspect exact container {name}; retain reservation', flush=True)
        return 1
    output = result.stdout.decode(errors='replace')
    print(output, end='', flush=True)
    print(f'CASE_RESULT network-boundary rc={result.returncode}', flush=True)
    check = subprocess.run(['docker','ps','--all','--quiet','--filter',f'name=^/{name}$'], capture_output=True, text=True, timeout=15)
    if check.returncode or check.stdout.strip():
        print('STOP: exact container cleanup unverified; retain reservation', flush=True)
        print(check.stdout + check.stderr, flush=True)
        return 1
    print(f'CLEANUP_VERIFIED {name} absent', flush=True)
    caps = {k: int(v,16) for k,v in re.findall(r'^(Cap\w+):\s*([0-9a-fA-F]+)$',output,re.M)}
    expected = ['PASS: unsandboxed direct TCP positive control', 'PASS: exec child denied direct TCP after clearing proxy variables', 'PASS: allowlisted HTTPS response 200, certificate verified, expected content', 'PASS: unlisted domain CONNECT explicitly denied with 403', 'PASS: network acceptance complete']
    if result.returncode or not all(x in output for x in expected) or not all(caps.get(k) == 0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']):
        print('STOP: network boundary acceptance failed; do not widen grants', flush=True)
        return 1
    print('PASS: network acceptance verified. Provider inference, real role profiles and restore NOT TESTED.', flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

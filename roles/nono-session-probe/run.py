#!/usr/bin/env python3
"""Credential-free local session/process-persistence check; default prints the plan. Human executes under reservation."""
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
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent
POLICY = Path('/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json')
FIXTURE = Path('/home/vscode/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex')

def run_with_exit_evidence(command, payload):
    """Inspect this run's stopped container before exact-ID cleanup.

    No auto-remove: it discarded the only useful exit/OOM evidence. A private
    cidfile identifies the container actually created by this invocation. Never
    remove by a guessed name, force-stop a running container or widen resources.
    """
    with tempfile.TemporaryDirectory(prefix='roe-session-cid-') as directory:
        cidfile = Path(directory) / 'container.id'
        cmd = list(command)
        cmd[2:2] = ['--cidfile', str(cidfile)]
        try:
            result = subprocess.run(cmd, input=payload, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, timeout=75)
        except subprocess.TimeoutExpired as error:
            result = subprocess.CompletedProcess(cmd, 124, error.stdout or b'')
            print('STOP: Docker client timeout; inspect exit evidence; no automatic rerun', flush=True)
        output = result.stdout.decode(errors='replace')
        print(output, end='', flush=True)
        print(f'CASE_RESULT local-session rc={result.returncode}', flush=True)
        cid = cidfile.read_text().strip() if cidfile.is_file() else ''
        if not re.fullmatch(r'[0-9a-f]{64}', cid):
            print('STOP: no valid invocation-owned container ID; no container removal attempted', flush=True)
            return result, False
        inspect = subprocess.run(['docker', 'inspect', '--type', 'container', '--format',
                                  '{{json .State}}', cid], capture_output=True, text=True, timeout=15)
        if inspect.returncode:
            print('STOP: exact container state unavailable; retain reservation', flush=True)
            print(inspect.stderr, flush=True)
            return result, False
        try:
            state = json.loads(inspect.stdout)
        except ValueError:
            print('STOP: malformed container state; retain reservation', flush=True)
            return result, False
        print('CONTAINER_EXIT_STATE ' + json.dumps(state, sort_keys=True), flush=True)
        if not isinstance(state, dict) or state.get('Running') is not False or state.get('Status') != 'exited':
            print('STOP: container not proven stopped; no forced removal', flush=True)
            return result, False
        logs = subprocess.run(['docker', 'logs', '--tail', '200', cid],
                              capture_output=True, text=True, timeout=15)
        print('DOCKER_STORED_LOGS rc=' + str(logs.returncode), flush=True)
        print(logs.stdout + logs.stderr, flush=True)
        print('END_DOCKER_STORED_LOGS', flush=True)
        if result.returncode == 124:
            print('STOP: timeout evidence captured; retain exact container for review', flush=True)
            return result, False
        removed = subprocess.run(['docker', 'rm', cid], capture_output=True, text=True, timeout=15)
        if removed.returncode:
            print('STOP: exact stopped-container removal failed; retain reservation', flush=True)
            print(removed.stderr, flush=True)
            return result, False
        print('EXACT_CONTAINER_REMOVED ' + cid, flush=True)
        return result, logs.returncode == 0

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
    # Retain this exact disposable container until its exit evidence is captured.
    command.remove('--rm')
    command[command.index('--memory=512m')] = '--memory=1g'
    command[command.index('--memory-swap=512m')] = '--memory-swap=1g'
    command[command.index('/tmp:rw,exec,nosuid,nodev,size=128m,mode=1777')] = '/tmp:rw,exec,nosuid,nodev,size=512m,mode=1777'
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
        for filename, data, mode in [('nono', binary, 0o755), ('tools/codex/codex', FIXTURE.read_bytes(), 0o755), ('tools/client.py', (ROOT/'client.py').read_bytes(), 0o644), ('tools/check.sh', (ROOT/'check.sh').read_bytes(), 0o644), ('profile.json', (ROOT/'profile.json').read_bytes(), 0o644), ('entry.sh', (ROOT/'entry.sh').read_bytes(), 0o644)]:
            item = tarfile.TarInfo(filename)
            item.size = len(data); item.mode = mode; item.uid = 1000; item.gid = 1000
            archive.addfile(item, io.BytesIO(data))
        with tarfile.open('/workspace/tmp/ai-pilot-session-python.tar') as runtime:
            for item in runtime.getmembers():
                path=Path(item.name)
                if not item.isfile() or path.is_absolute() or '..' in path.parts or not item.name.startswith('tools/python/'):
                    raise RuntimeError('Unsafe runtime bundle member')
                archive.addfile(item, runtime.extractfile(item))
    result, evidence_ok = run_with_exit_evidence(command, stream.getvalue())
    output = result.stdout.decode(errors='replace')
    check = subprocess.run(['docker','ps','--all','--quiet','--filter',f'name=^/{name}$'], capture_output=True, text=True, timeout=15)
    if check.returncode or check.stdout.strip():
        print('STOP: exact container cleanup unverified; retain reservation', flush=True)
        print(check.stdout + check.stderr, flush=True)
        return 1
    print(f'CLEANUP_VERIFIED {name} absent', flush=True)
    caps = {k: int(v,16) for k,v in re.findall(r'^(Cap\w+):\s*([0-9a-fA-F]+)$',output,re.M)}
    expected = ['PASS: unsandboxed filesystem controls', 'PASS: session child protected and sibling read denials', 'PASS: credential-free app-server initialization and explicit thread identity', 'OBSERVED: first process exited cleanly; rollout files=', 'PASS: exact thread identity and name recovered after process restart', 'PASS: credential-free process persistence fixture complete']
    if not evidence_ok or result.returncode or not all(x in output for x in expected) or not all(caps.get(k) == 0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']):
        print('STOP: local session acceptance failed; do not widen grants', flush=True)
        return 1
    print('PASS: local process persistence verified; auth/inference, native sockets, container persistence and Herdr restore NOT TESTED.', flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

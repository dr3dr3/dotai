"""No-turn app-server fixture; run only inside the disposable restricted child."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

ALLOWED = {'initialize', 'thread/start', 'thread/name/set', 'thread/read', 'thread/resume'}
BINARY = '/tmp/probe/tools/codex/codex'
STATE = Path('/tmp/role/home/.codex')
OUT = Path('/tmp/role/output')

class Client:
    def __init__(self, label):
        print('STAGE: '+label+' spawning app-server', flush=True)
        self.proc = subprocess.Popen([BINARY, 'app-server', '--listen', 'stdio://'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None,
            cwd='/tmp/role/work', env=dict(os.environ), bufsize=0)
        print('STAGE: '+label+' app-server spawned', flush=True)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.proc.stdout, selectors.EVENT_READ)
        self.buffer = b''
        self.serial = 0

    def receive(self, deadline):
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.selector.select(remaining):
                raise RuntimeError('protocol response timed out')
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError('app-server closed its output')
            self.buffer += chunk
            if len(self.buffer) > 2_000_000:
                raise RuntimeError('unexpectedly large protocol response')
        line, self.buffer = self.buffer.split(b'\n', 1)
        return json.loads(line)

    def call(self, method, params):
        if method not in ALLOWED:
            raise ValueError('fixture forbids method: ' + method)
        self.serial += 1
        self.proc.stdin.write((json.dumps({'id':self.serial,'method':method,'params':params})+'\n').encode())
        deadline = time.monotonic() + 12
        while True:
            msg = self.receive(deadline)
            if 'method' in msg and 'id' in msg:
                raise RuntimeError('unexpected server request; no approval is permitted')
            if msg.get('id') != self.serial:
                if 'id' in msg:
                    raise RuntimeError('unexpected response identity')
                continue
            if 'error' in msg:
                raise RuntimeError(method + ': ' + json.dumps(msg['error']))
            return msg['result']

    def initialize(self):
        print('STAGE: initializing protocol', flush=True)
        self.call('initialize', {'clientInfo':{'name':'roe_offline_fixture','version':'1'}})
        self.proc.stdin.write(b'{"method":"initialized"}\n')

    def stop(self):
        self.proc.stdin.close()
        try:
            rc = self.proc.wait(timeout=6)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try: self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill(); self.proc.wait(timeout=2)
            raise RuntimeError('app-server did not stop cleanly on EOF')
        finally:
            self.selector.close(); self.proc.stdout.close()
        if rc:
            raise RuntimeError('app-server exit code ' + str(rc))


def denied_reads():
    for path in ('/tmp/other-role/marker', '/tmp/role/home/.local/state/nono/marker'):
        try: Path(path).read_text()
        except PermissionError: pass
        else: raise RuntimeError('protected read unexpectedly permitted')
    print('PASS: session child protected and sibling read denials', flush=True)


def main():
    if (STATE/'auth.json').exists():
        raise RuntimeError('fixture must not have authentication')
    denied_reads()
    marker = 'roe-offline-persistence-fixture'
    client = Client('first')
    try:
        client.initialize()
        thread = client.call('thread/start', {'cwd':'/tmp/role/work',
            'ephemeral':False, 'approvalPolicy':'never', 'sandbox':'danger-full-access',
            'developerInstructions':'Offline storage fixture. No turn or tool execution is authorised.'})['thread']
        identity = thread['id']
        if not isinstance(identity,str) or not identity:
            raise RuntimeError('missing provider thread identity')
        client.call('thread/name/set', {'threadId':identity, 'name':marker})
        (OUT/'binding.json').write_text(json.dumps({'harness':'codex','thread_id':identity}))
        print('PASS: credential-free app-server initialization and explicit thread identity', flush=True)
    finally:
        client.stop()
    rollouts = list(STATE.glob('sessions/**/*.jsonl'))
    print('OBSERVED: first process exited cleanly; rollout files=' + str(len(rollouts)), flush=True)
    # A zero-turn thread had no rollout in the first live run. The protocol,
    # rather than a presumed file layout, decides whether exact-ID persistence
    # exists. Do not create a turn or fabricate a rollout to make it pass.
    client = Client('second')
    try:
        client.initialize()
        identity = json.loads((OUT/'binding.json').read_text())['thread_id']
        read = client.call('thread/read', {'threadId':identity,'includeTurns':False})['thread']
        resumed = client.call('thread/resume', {'threadId':identity,'excludeTurns':True})['thread']
        if read['id'] != identity or resumed['id'] != identity or read.get('name') != marker:
            raise RuntimeError('persisted identity/name mismatch')
        denied_reads()
        print('PASS: exact thread identity and name recovered after process restart', flush=True)
    finally:
        client.stop()
    print('PASS: credential-free process persistence fixture complete', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('FIXTURE_ERROR: '+type(error).__name__+': '+str(error), flush=True)
        for p in sorted(OUT.glob('*.stderr')):
            print(p.name + ': ' + p.read_text(errors='replace')[-6000:], flush=True)
        raise

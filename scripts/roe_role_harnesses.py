"""Personal role harness adapters. No live activation or automatic fallback."""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys

SOURCE = Path(__file__).resolve().parents[1]

def resolve_native_codex(pin_path=None):
    pin=json.loads(Path(pin_path or SOURCE/'roles/codex-runtime.json').read_text())
    if pin.get('schema_version') != 1:
        raise ValueError('unsupported Codex runtime pin')
    if pin.get('platform') != sys.platform or pin.get('machine') != platform.machine():
        raise ValueError('Codex runtime pin does not match this environment')
    binary=Path(pin['path'])
    if not binary.is_absolute() or not binary.is_file() or not os.access(binary,os.X_OK):
        raise ValueError('reviewed native Codex executable missing; no PATH fallback')
    with binary.open('rb') as stream:
        if stream.read(4) != b'\x7fELF':
            raise ValueError('Codex runtime must be the reviewed native ELF, not a wrapper')
        stream.seek(0)
        digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if digest != pin.get('sha256'):
        raise ValueError('Codex executable changed; review and re-pin before launch')
    return binary.resolve()


class CodexAdapter:
    name = 'codex'
    status = 'candidate'
    missing_checks = ('local session/socket operation', 'persistent state',
                      'provider authentication and bounded inference', 'verified restart/resume')

    def state_dirs(self, base):
        return [base/'home/.codex']

    def profile_fields(self, base, binary, auth):
        return {'read': [str(binary.parent.parent)],
                'read_file': [str(auth)],
                'socket_bind': [str(base/'home/.codex')],
                'domains': ['chatgpt.com','auth.openai.com','api.openai.com'],
                'environment': ['CODEX_HOME']}

    def resolve(self, pin_path=None):
        return resolve_native_codex(pin_path)

    def auth_path(self):
        return (Path.home()/'.codex/auth.json').resolve()

    def prepare_state(self, base, auth):
        link=base/'home/.codex/auth.json'
        if link.is_symlink():
            if link.resolve()!=auth: raise ValueError('unexpected role auth symlink')
        elif link.exists():
            raise ValueError('existing role auth is not the expected read-only link')
        cfg=base/'home/.codex/config.toml'
        if cfg.is_symlink(): raise ValueError('generated config must not be a symlink')
        if not link.is_symlink(): link.symlink_to(auth)
        cfg.write_text('approval_policy = "never"\nsandbox_mode = "danger-full-access"\nweb_search = "disabled"\ncli_auth_credentials_store = "file"\n')

    def child_env(self, base):
        return {'CODEX_HOME': str(base/'home/.codex')}

    def arguments(self, base, instructions, resume=False):
        if resume:
            raise ValueError('Codex resume requires verified session binding; implicit --last is disabled')
        return ['--sandbox','danger-full-access','--ask-for-approval','never',
                '-c',f'developer_instructions={json.dumps(instructions)}',
                '-C',str(base/'work')]

class UnverifiedAdapter:
    status = 'unverified'
    missing_checks = ('executable and runtime pin', 'private state and credential handling',
                      'instruction loading', 'filesystem/network/socket boundaries',
                      'provider session identity', 'launch and resume acceptance')

    def __init__(self, name):
        self.name=name

ADAPTERS = {'codex': CodexAdapter(), 'claude': UnverifiedAdapter('claude'),
            'pi': UnverifiedAdapter('pi')}

def describe(name):
    adapter=get(name)
    return {'harness': adapter.name, 'status': adapter.status,
            'activation': 'disabled', 'missing_checks': list(adapter.missing_checks)}

def get(name, require_implementation=False):
    if name not in ADAPTERS:
        raise ValueError(f'unknown harness {name!r}; choose codex, claude or pi')
    adapter=ADAPTERS[name]
    if require_implementation and adapter.status == 'unverified':
        raise ValueError(f'{name} adapter is unverified: '+', '.join(adapter.missing_checks)+
                         '; no fallback or state changes')
    return adapter

import importlib.machinery
import importlib.util
from pathlib import Path
import tempfile
import hashlib
import json
import os
import platform
import subprocess
import sys
from unittest.mock import patch
import unittest

ROOT=Path(__file__).resolve().parents[1]
loader=importlib.machinery.SourceFileLoader('roe_role',str(ROOT/'scripts/roe-role'))
spec=importlib.util.spec_from_loader(loader.name,loader)
m=importlib.util.module_from_spec(spec);loader.exec_module(m)

class Roles(unittest.TestCase):
    def test_unverified_activation_is_refused(self):
        for resume in (False, True):
            with self.assertRaisesRegex(ValueError, 'activation disabled'):
                m.run('baxter', resume)

    def test_role_traversal_and_unknown_are_rejected(self):
        for role in ('../scrum','/tmp','firstmate','unknown'):
            with self.assertRaises(ValueError): m.role_record(role)

    def test_catalogue_preserves_seven_domain_roles_and_named_managers(self):
        roles=m.catalog()['roles']
        for role in ('business','team','standards','quality','security','observability','configuration',
                     'baxter','hannibal','danny','jules','pilot'):
            self.assertIn(role,roles)

    def test_symlink_state_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); (root/'actual').mkdir();(root/'state').symlink_to(root/'actual')
            with self.assertRaises(ValueError): m.paths('baxter',root,root/'state')

    def test_output_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); context=root/'context'; context.mkdir()
            parent=context/'plans/active/macbook-pilot-records';parent.mkdir(parents=True)
            (parent/'baxter').symlink_to(root)
            with self.assertRaises(ValueError): m.paths('baxter',context,root/'state')

    def test_profile_does_not_grant_shared_home_or_control_sockets(self):
        p=m.profile(Path('/state/baxter'),Path('/docs/output/baxter'),Path('/docs'),
                    Path('/tools/codex/bin/codex'),Path('/credentials/auth.json'))
        self.assertEqual(p['linux']['af_unix_mediation'],'pathname')
        self.assertFalse(p['security']['capability_elevation'])
        grants=[Path(x) for x in p['filesystem']['allow']]
        for protected in ('/state/baxter/home/.local/state/nono',
                          '/state/baxter/home/.config/nono',
                          '/state/quality/home/.codex'):
            self.assertFalse(any(Path(protected).is_relative_to(g) for g in grants))
        self.assertTrue(any(Path('/state/baxter/home/.codex/history.jsonl').is_relative_to(g) for g in grants))
        self.assertEqual(p['filesystem']['unix_socket_subtree_bind'],['/state/baxter/home/.codex'])
        self.assertNotIn('/tmp',p['filesystem']['allow'])
        self.assertNotIn('/workspace',p['filesystem']['read'])
        self.assertNotIn('block',p['network'])
        self.assertEqual(set(p['network']['allow_domain']),{'chatgpt.com','auth.openai.com','api.openai.com'})
        self.assertIn('HERDR_*',p['environment']['deny_vars'])


    def test_private_xdg_parent_symlinks_are_rejected(self):
        for relative in ('home/.config','home/.cache','home/.local','home/.local/state'):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d); context=root/'context'; context.mkdir()
                state=root/'state'; target=state/'baxter'/relative
                target.parent.mkdir(parents=True)
                outside=root/'outside'; outside.mkdir()
                target.symlink_to(outside)
                with self.assertRaises(ValueError):
                    m.paths('baxter',context,state)

    def test_native_runtime_pin_rejects_wrapper_and_changed_binary(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);binary=root/'codex';binary.write_bytes(b'\x7fELFfixture');binary.chmod(0o700)
            pin=root/'pin.json'
            data={'schema_version':1,'platform':sys.platform,'machine':platform.machine(),
                  'path':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
            pin.write_text(json.dumps(data))
            self.assertEqual(m.resolve_codex(pin),binary)
            binary.write_bytes(b'\x7fELFchanged')
            with self.assertRaisesRegex(ValueError,'changed'): m.resolve_codex(pin)
            binary.write_text('#!/bin/sh\n')
            with self.assertRaisesRegex(ValueError,'native ELF'): m.resolve_codex(pin)
            binary.unlink()
            with self.assertRaisesRegex(ValueError,'missing'): m.resolve_codex(pin)

    def test_busy_role_refuses_prepare_before_writing(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);context=root/'context';context.mkdir();state=root/'state'
            with m.role_lock('baxter',context,state):
                with patch.object(m,'_prepare') as prepare:
                    with self.assertRaisesRegex(ValueError,'busy'):
                        m.prepare('baxter',context,state)
                    prepare.assert_not_called()
                lock=state/'baxter/operator.lock'
                result=subprocess.run([sys.executable,'-c',
                    'import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',str(lock)],capture_output=True)
                self.assertNotEqual(result.returncode,0)
                self.assertIn(b'BlockingIOError',result.stderr)
            with m.role_lock('baxter',context,state): pass

    def test_lock_release_on_error_and_unsafe_lock_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);context=root/'context';context.mkdir();state=root/'state'
            with self.assertRaisesRegex(RuntimeError,'fixture'):
                with m.role_lock('baxter',context,state): raise RuntimeError('fixture')
            with m.role_lock('baxter',context,state): pass
            lock=state/'baxter/operator.lock';lock.unlink()
            outside=root/'outside';outside.write_text('preserve')
            lock.symlink_to(outside)
            with self.assertRaises(OSError):
                with m.role_lock('baxter',context,state): pass
            self.assertEqual(outside.read_text(),'preserve')
            lock.unlink();os.link(outside,lock)
            with self.assertRaisesRegex(ValueError,'single-link'):
                with m.role_lock('baxter',context,state): pass

    def test_unverified_harness_never_prepares_or_falls_back(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);context=root/'context';context.mkdir();state=root/'state'
            for harness in ('claude','pi'):
                with patch.object(m,'_prepare') as prepare:
                    with self.assertRaisesRegex(ValueError, harness+' adapter is unverified'):
                        m.prepare('baxter',context,state,harness)
                    prepare.assert_not_called()
                self.assertFalse(state.exists())
                with self.assertRaisesRegex(ValueError,'unverified'):
                    m.run('baxter',harness=harness)
            with self.assertRaisesRegex(ValueError,'unknown harness'):
                m.harnesses.get('unknown')

    def test_codex_requires_explicit_verified_resume_binding(self):
        adapter=m.harnesses.get('codex',True)
        with self.assertRaisesRegex(ValueError,'verified session binding'):
            adapter.arguments(Path('/role'),'fixture',resume=True)
        args=adapter.arguments(Path('/role'),'fixture')
        self.assertNotIn('--last',args)
        self.assertIn('developer_instructions="fixture"',args)
        self.assertEqual(adapter.child_env(Path('/role')),{'CODEX_HOME':'/role/home/.codex'})

    def test_harness_inspection_has_no_state_side_effects(self):
        for name in ('codex','claude','pi'):
            info=m.harnesses.describe(name)
            self.assertEqual(info['harness'],name)
            self.assertEqual(info['activation'],'disabled')
            self.assertTrue(info['missing_checks'])

    def test_context_is_role_specific_and_limits_authority(self):
        prompt=m.prompt('baxter',Path('/out/baxter'),Path('/docs'))
        self.assertIn('Baxter',prompt)
        self.assertIn('not Firstmate',prompt)
        self.assertIn('Write only to /out/baxter',prompt)
        self.assertIn('Do not contact other sessions',prompt)
        self.assertIn('checkpoint.md',prompt)

if __name__=='__main__': unittest.main()

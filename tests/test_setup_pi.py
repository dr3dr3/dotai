"""Exercise Pi wiring with isolated state: persistence, provider merge, gateway key."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('setup_pi', SCRIPTS / 'setup-pi.py')
setup_pi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup_pi)

COMMITTED = SCRIPTS.parent / 'sandbox/profiles/config/pi/models.json'

GENERATED_OLLAMA = {
    'baseUrl': 'http://host.docker.internal:11434/v1',
    'api': 'openai-completions',
    'apiKey': 'ollama',
    'models': [{'id': 'qwen3.8:27b-mtp-q4_K_M', 'name': 'generated', 'reasoning': True,
                'input': ['text'], 'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
                'contextWindow': 65536, 'maxTokens': 16384}],
}


class SetupPiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.volume = self.home / '.ai'
        self.volume.mkdir()
        self.agent = self.home / '.pi/agent'
        self.target = self.volume / 'pi'
        self.enterContext(patch.dict(os.environ, {'HOME': str(self.home), 'PI_SETUP_FORCE_VOLUME': '1'}, clear=False))
        for name in ('AI_GATEWAY_API_KEY', 'AI_GATEWAY_OP_REF', 'PI_CODING_AGENT_DIR'):
            os.environ.pop(name, None)
        os.environ['ROE_TOOLING_ENV'] = str(self.home / '.config/roe/tooling.env')  # absent unless a test writes it

    def run_main(self, *extra):
        argv = ['setup-pi.py', '--agent-dir', str(self.agent), '--volume', str(self.volume), *extra]
        with patch('sys.argv', argv):
            setup_pi.main()

    def live(self):
        return json.loads((self.agent / 'models.json').read_text())

    # -- committed file --------------------------------------------------------
    def test_committed_models_json_is_gateway_plus_ollama_stub(self):
        committed = setup_pi.load_json(COMMITTED, allow_comments=True)['providers']
        self.assertEqual(set(committed), {'vercel-ai-gateway', 'ollama'})
        ids = [m['id'] for m in committed['vercel-ai-gateway']['models']]
        self.assertIn('deepseek/deepseek-v4.1-flash', ids)
        # The Ollama list is generated from the host; a committed list goes stale.
        self.assertNotIn('models', committed['ollama'])
        self.assertEqual(committed['ollama']['baseUrl'], 'http://host.docker.internal:11434/v1')

    # -- persistence -----------------------------------------------------------
    def test_fresh_persist_merge_and_repeat(self):
        self.run_main('--no-key')
        self.assertTrue(self.agent.is_symlink())
        self.assertEqual(self.agent.resolve(), self.target.resolve())
        self.assertEqual((self.agent / 'models.json').resolve().parent, self.target.resolve())
        live = self.live()['providers']
        self.assertIn('deepseek/deepseek-v4.1-flash', [m['id'] for m in live['vercel-ai-gateway']['models']])
        self.assertNotIn('models', live['ollama'])
        before = (self.target / 'models.json').read_bytes()
        self.run_main('--no-key')
        self.assertEqual((self.target / 'models.json').read_bytes(), before)

    def test_migrates_host_script_shape_without_losing_generated_list(self):
        # Shape left by the host-side Ollama script: real file on the volume,
        # models.json symlink in a real ~/.pi/agent, plus backups and auth.json.
        self.target.mkdir()
        (self.target / 'models.json').write_text(json.dumps({'providers': {'ollama': GENERATED_OLLAMA}}))
        self.agent.mkdir(parents=True)
        (self.agent / 'models.json').symlink_to(self.target / 'models.json')
        (self.agent / 'models.json.bak.1').write_text('{"old": true}')
        (self.agent / 'auth.json').write_text('{}')
        (self.agent / 'extensions').mkdir()
        (self.agent / 'extensions/herdr-agent-state.ts').write_text('export {}')

        self.run_main('--no-key')

        self.assertTrue(self.agent.is_symlink())
        live = self.live()['providers']
        self.assertEqual(live['ollama']['models'], GENERATED_OLLAMA['models'])
        self.assertIn('vercel-ai-gateway', live)
        self.assertEqual((self.target / 'models.json.bak.1').read_text(), '{"old": true}')
        self.assertEqual((self.target / 'extensions/herdr-agent-state.ts').read_text(), 'export {}')
        self.assertFalse((self.target / 'models.json').is_symlink())

    def test_collision_keeps_volume_copy_and_parks_container_copy(self):
        self.target.mkdir()
        (self.target / 'auth.json').write_text('{"volume": true}')
        self.agent.mkdir(parents=True)
        (self.agent / 'auth.json').write_text('{"container": true}')
        self.run_main('--no-key')
        self.assertEqual((self.target / 'auth.json').read_text(), '{"volume": true}')
        parked = list(self.target.glob('auth.json.pre-persistence.*'))
        self.assertEqual(len(parked), 1)
        self.assertEqual(parked[0].read_text(), '{"container": true}')

    def test_no_volume_leaves_agent_dir_in_place(self):
        os.environ.pop('PI_SETUP_FORCE_VOLUME')
        with patch.object(Path, 'is_mount', return_value=False):
            self.run_main('--no-key')
        self.assertFalse(self.agent.is_symlink())
        self.assertTrue((self.agent / 'models.json').is_file())

    # -- merge rules -----------------------------------------------------------
    def test_merge_upserts_by_id_and_keeps_live_only_models(self):
        live = {'baseUrl': 'x', 'models': [
            {'id': 'deepseek/deepseek-v4.1-flash', 'name': 'stale'},
            {'id': 'openai/gpt-6-astra', 'name': 'mine'},
        ]}
        committed = {'baseUrl': 'y', 'models': [{'id': 'deepseek/deepseek-v4.1-flash', 'name': 'fresh'}]}
        merged = setup_pi.merge_provider(live, committed)
        self.assertEqual(merged['baseUrl'], 'y')
        self.assertEqual([m['name'] for m in merged['models']], ['fresh', 'mine'])

    def test_stub_without_models_never_clobbers_generated_list(self):
        merged = setup_pi.merge_provider(GENERATED_OLLAMA, {'baseUrl': 'http://new/v1', 'apiKey': 'ollama'})
        self.assertEqual(merged['models'], GENERATED_OLLAMA['models'])
        self.assertEqual(merged['baseUrl'], 'http://new/v1')

    def test_invalid_live_json_is_not_overwritten(self):
        self.target.mkdir()
        (self.target / 'models.json').write_text('{not json')
        with self.assertRaises(SystemExit):
            self.run_main('--no-key')
        self.assertEqual((self.target / 'models.json').read_text(), '{not json')

    def test_untouched_provider_survives(self):
        self.target.mkdir()
        (self.target / 'models.json').write_text(json.dumps({'providers': {'custom': {'baseUrl': 'z', 'api': 'openai-completions', 'models': [{'id': 'm'}]}}}))
        self.run_main('--no-key')
        self.assertEqual(self.live()['providers']['custom']['models'], [{'id': 'm'}])

    # -- default model + gateway key ------------------------------------------
    def test_default_model_seeded_once(self):
        self.run_main('--no-key')
        settings = json.loads((self.agent / 'settings.json').read_text())
        self.assertEqual((settings['defaultProvider'], settings['defaultModel']), setup_pi.DEFAULT_MODEL)
        (self.agent / 'settings.json').write_text(json.dumps({'defaultProvider': 'ollama', 'defaultModel': 'q'}))
        self.run_main('--no-key')
        self.assertEqual(json.loads((self.agent / 'settings.json').read_text())['defaultProvider'], 'ollama')

    def test_gateway_key_from_env_lands_in_auth_json_0600(self):
        os.environ['AI_GATEWAY_API_KEY'] = 'vck_test'
        self.run_main()
        auth_path = self.agent / 'auth.json'
        auth = json.loads(auth_path.read_text())
        self.assertEqual(auth['vercel-ai-gateway'], {'type': 'api_key', 'key': 'vck_test'})
        self.assertEqual(stat.S_IMODE(auth_path.stat().st_mode), 0o600)
        self.run_main()
        self.assertEqual(json.loads(auth_path.read_text()), auth)

    def test_gateway_key_merges_into_existing_auth_json(self):
        self.target.mkdir()
        (self.target / 'auth.json').write_text(json.dumps({'anthropic': {'type': 'api_key', 'key': 'keep'}}))
        os.environ['AI_GATEWAY_API_KEY'] = 'vck_test'
        self.run_main()
        auth = json.loads((self.agent / 'auth.json').read_text())
        self.assertEqual(auth['anthropic']['key'], 'keep')
        self.assertEqual(auth['vercel-ai-gateway']['key'], 'vck_test')

    def test_gateway_key_from_local_dev_env_tooling_secrets(self):
        # local-dev-env's `make tool-auth` writes ~/.config/roe/tooling.env (ADR-2026-09-14-1).
        tooling = Path(os.environ['ROE_TOOLING_ENV'])
        tooling.parent.mkdir(parents=True)
        tooling.write_text('VERCEL_TOKEN=vt\nexport AI_GATEWAY_API_KEY="vck_tooling"\nOTHER=x\n')
        with patch('shutil.which', return_value=None):  # op must not be needed
            self.run_main()
        self.assertEqual(json.loads((self.agent / 'auth.json').read_text())['vercel-ai-gateway']['key'], 'vck_tooling')

    def test_env_var_beats_tooling_secrets(self):
        tooling = Path(os.environ['ROE_TOOLING_ENV'])
        tooling.parent.mkdir(parents=True)
        tooling.write_text('AI_GATEWAY_API_KEY=vck_tooling\n')
        os.environ['AI_GATEWAY_API_KEY'] = 'vck_env'
        self.run_main()
        self.assertEqual(json.loads((self.agent / 'auth.json').read_text())['vercel-ai-gateway']['key'], 'vck_env')

    def test_gateway_key_from_1password(self):
        fake_bin = self.home / 'bin'
        fake_bin.mkdir()
        (fake_bin / 'op').write_text('#!/bin/sh\n[ "$1 $2 $3 $4" = "read --account acct op://V/I/f" ] && echo vck_op && exit 0\necho "bad args: $*" >&2; exit 1\n')
        (fake_bin / 'op').chmod(0o755)
        with patch.dict(os.environ, {'PATH': f"{fake_bin}:{os.environ['PATH']}", 'OP_ACCOUNT': 'acct', 'AI_GATEWAY_OP_REF': 'op://V/I/f'}):
            self.run_main()
        self.assertEqual(json.loads((self.agent / 'auth.json').read_text())['vercel-ai-gateway']['key'], 'vck_op')

    def test_missing_key_is_not_fatal(self):
        with patch('shutil.which', return_value=None):
            self.run_main()
        self.assertFalse((self.agent / 'auth.json').exists())

    def test_default_op_ref_matches_local_dev_env_template(self):
        self.assertEqual(setup_pi.DEFAULT_OP_REF, 'op://ROE - CTO/Vercel AI Gateway/credential')


if __name__ == '__main__':
    unittest.main()

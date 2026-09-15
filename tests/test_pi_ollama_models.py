"""Exercise the Ollama model-list generator against a fake Ollama HTTP API."""
import importlib.util
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys
sys.dont_write_bytecode = True
import tempfile
import threading
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('gen', SCRIPTS / 'pi-ollama-models.py')
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


def show(caps, arch='qwen3', ctx=262144, params='', size='27.3B', quant='Q4_K_M'):
    return {
        'capabilities': caps,
        'parameters': params,
        'details': {'parameter_size': size, 'quantization_level': quant},
        'model_info': {f'{arch}.context_length': ctx, f'{arch}.embedding_length': 4096},
    }


class FakeOllama:
    def __init__(self):
        self.tags = []
        self.shows = {}
        self.ps = []
        self.served = {}      # tag -> context_length reported once loaded via /api/generate
        self.loads = []       # tags that were probe-loaded
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, payload):
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == '/api/version':
                    return self._send({'version': '0.13.0-test'})
                if self.path == '/api/tags':
                    return self._send({'models': [{'name': t} for t in outer.tags]})
                if self.path == '/api/ps':
                    return self._send({'models': outer.ps})
                self.send_error(404)

            def do_POST(self):
                length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(length) or b'{}')
                if self.path == '/api/show':
                    return self._send(outer.shows[payload['model']])
                if self.path == '/api/generate':
                    tag = payload['model']
                    outer.loads.append(tag)
                    if tag in outer.served:
                        outer.ps = [m for m in outer.ps if m['name'] != tag] + [{'name': tag, 'context_length': outer.served[tag]}]
                    return self._send({'model': tag, 'done': True, 'done_reason': 'load'})
                self.send_error(404)

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class GeneratorTest(unittest.TestCase):
    def setUp(self):
        self.ollama = FakeOllama()
        self.addCleanup(self.ollama.close)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'models.json'
        for name in ('PI_OLLAMA_CONTEXT_LENGTH', 'PI_OLLAMA_URL', 'OLLAMA_HOST'):
            os.environ.pop(name, None)

    def run_main(self, *extra):
        with patch('sys.argv', ['pi-ollama-models.py', '--models-json', str(self.path), '--url', self.ollama.url, *extra]):
            gen.main()

    def providers(self):
        return json.loads(self.path.read_text())['providers']

    def test_capabilities_map_to_pi_fields_and_non_completion_is_skipped(self):
        self.ollama.tags = ['think-vision:latest', 'plain:latest', 'embed:latest']
        self.ollama.shows = {
            'think-vision:latest': show(['completion', 'thinking', 'vision'], params='num_ctx 65536'),
            'plain:latest': show(['completion'], params='num_ctx 32768', size='7B', quant='Q8_0'),
            'embed:latest': show(['embedding']),
        }
        self.run_main()
        models = {m['id']: m for m in self.providers()['ollama']['models']}
        self.assertEqual(set(models), {'think-vision:latest', 'plain:latest'})
        tv = models['think-vision:latest']
        self.assertTrue(tv['reasoning'])
        self.assertEqual(tv['input'], ['text', 'image'])
        self.assertEqual(tv['thinkingLevelMap']['off'], 'none')
        self.assertNotIn('thinkingLevelMap', tv['compat'])  # inside compat it is inert
        self.assertTrue(tv['compat']['supportsReasoningEffort'])
        self.assertNotIn('thinkingFormat', tv['compat'])  # Ollama ignores chat_template_kwargs
        self.assertEqual(tv['contextWindow'], 65536)
        self.assertEqual(tv['name'], 'think-vision (local Ollama, 27.3B Q4_K_M)')
        plain = models['plain:latest']
        self.assertFalse(plain['reasoning'])
        self.assertNotIn('thinkingLevelMap', plain)
        self.assertEqual(plain['input'], ['text'])
        self.assertFalse(plain['compat']['supportsReasoningEffort'])
        self.assertEqual(plain['maxTokens'], 16384)

    def test_served_context_is_measured_by_probe_load(self):
        # Ground truth is what /api/ps reports once loaded — it beats the
        # Modelfile, the env, and the architecture maximum.
        self.ollama.tags = ['already:1', 'probe:1', 'capped:1']
        self.ollama.shows = {
            'already:1': show(['completion'], params='num_ctx 8192'),   # loaded: ps wins over Modelfile
            'probe:1': show(['completion'], params='num_ctx 8192'),     # not loaded: probe, then ps wins
            'capped:1': show(['completion'], ctx=2048),                 # served > arch max → capped
        }
        self.ollama.ps = [{'name': 'already:1', 'context_length': 40000}]
        self.ollama.served = {'probe:1': 262144, 'capped:1': 4096}
        with patch.dict(os.environ, {'PI_OLLAMA_CONTEXT_LENGTH': '131072'}):
            self.run_main()
        models = {m['id']: m for m in self.providers()['ollama']['models']}
        self.assertEqual({k: m['contextWindow'] for k, m in models.items()},
                         {'already:1': 40000, 'probe:1': 262144, 'capped:1': 2048})
        self.assertEqual(models['capped:1']['maxTokens'], 2048)
        self.assertEqual(self.ollama.loads, ['capped:1', 'probe:1'])  # already-loaded model not reloaded

    def test_no_probe_falls_back_modelfile_then_env_then_warns(self):
        self.ollama.tags = ['a:1', 'c:1', 'x:1']
        self.ollama.shows = {
            'a:1': show(['completion'], params='num_ctx 8192'),
            'c:1': show(['completion']),
            'x:1': show(['completion']),
        }
        self.ollama.served = {'x:1': 262144}  # would be measurable, but --no-probe
        _, models, _, warnings = gen.generate(self.ollama.url, {'PI_OLLAMA_CONTEXT_LENGTH': '131072'}, 16384, probe=False)
        self.assertEqual({m['id']: m['contextWindow'] for m in models}, {'a:1': 8192, 'c:1': 131072, 'x:1': 131072})
        self.assertEqual(self.ollama.loads, [])
        _, models, _, warnings = gen.generate(self.ollama.url, {}, 16384, probe=False)
        self.assertEqual({m['id']: m['contextWindow'] for m in models}['x:1'], gen.OLLAMA_DEFAULT_NUM_CTX)
        self.assertEqual(len(warnings), 2)
        self.assertIn('--no-probe', warnings[0])

    def test_replaces_only_ollama_models_keeps_other_providers_and_backs_up(self):
        self.path.write_text(json.dumps({'providers': {
            'vercel-ai-gateway': {'models': [{'id': 'deepseek/deepseek-v4.1-flash'}]},
            'ollama': {'baseUrl': 'http://custom:11434/v1', 'api': 'openai-completions', 'apiKey': 'ollama',
                       'compat': {'supportsDeveloperRole': False},
                       'models': [{'id': 'stale:tag'}]},
        }}))
        self.ollama.tags = ['fresh:1']
        self.ollama.shows = {'fresh:1': show(['completion'], params='num_ctx 4096')}
        self.run_main()
        providers = self.providers()
        self.assertEqual(providers['vercel-ai-gateway']['models'][0]['id'], 'deepseek/deepseek-v4.1-flash')
        self.assertEqual(providers['ollama']['baseUrl'], 'http://custom:11434/v1')
        self.assertEqual(providers['ollama']['compat'], {'supportsDeveloperRole': False})
        self.assertEqual([m['id'] for m in providers['ollama']['models']], ['fresh:1'])
        backups = list(self.path.parent.glob('models.json.bak.*'))
        self.assertEqual(len(backups), 1)
        self.assertIn('stale:tag', backups[0].read_text())

    def test_idempotent_second_run_writes_nothing(self):
        self.ollama.tags = ['m:1']
        self.ollama.shows = {'m:1': show(['completion'], params='num_ctx 4096')}
        self.run_main()
        first = self.path.read_bytes()
        self.run_main()
        self.assertEqual(self.path.read_bytes(), first)
        self.assertEqual(list(self.path.parent.glob('models.json.bak.*')), [])

    def test_invalid_live_json_is_refused(self):
        self.path.write_text('{nope')
        self.ollama.tags = []
        with self.assertRaises(SystemExit):
            self.run_main()
        self.assertEqual(self.path.read_text(), '{nope')

    def test_unreachable_ollama_stops_and_reports(self):
        with self.assertRaises(SystemExit) as ctx:
            with patch('sys.argv', ['pi-ollama-models.py', '--models-json', str(self.path), '--url', 'http://127.0.0.1:9']):
                gen.main()
        self.assertIn('not reachable', str(ctx.exception))
        self.assertFalse(self.path.exists())

    def test_url_resolution(self):
        self.assertEqual(gen.ollama_url({}), 'http://host.docker.internal:11434')
        self.assertEqual(gen.ollama_url({'OLLAMA_HOST': 'host.docker.internal:11434'}), 'http://host.docker.internal:11434')
        self.assertEqual(gen.ollama_url({'OLLAMA_HOST': 'http://x:1/', 'PI_OLLAMA_URL': 'http://y:2'}), 'http://y:2')


if __name__ == '__main__':
    unittest.main()

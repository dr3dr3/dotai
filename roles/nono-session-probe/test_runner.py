"""Exit-evidence sequencing with fake Docker responses only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('session_runner', Path(__file__).with_name('run.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ExitEvidenceTests(unittest.TestCase):
    def scenario(self, *, running=False, cid=True, inspect_rc=0, timeout=False):
        commands = []
        state = {'Running': running, 'Status': 'running' if running else 'exited', 'OOMKilled': True, 'ExitCode': 137}
        def fake(command, **kwargs):
            commands.append(command)
            if command[1] == 'run':
                if cid:
                    Path(command[command.index('--cidfile') + 1]).write_text('a' * 64)
                if timeout:
                    raise subprocess.TimeoutExpired(command, 75, output=b'partial fixture stage\n')
                return subprocess.CompletedProcess(command, 1, b'fixture initialization\n')
            if command[1] == 'inspect':
                return subprocess.CompletedProcess(command, inspect_rc, json.dumps(state), 'inspection error' if inspect_rc else '')
            return subprocess.CompletedProcess(command, 0, 'a' * 64, '')
        output = io.StringIO()
        with patch.object(m.subprocess, 'run', side_effect=fake), contextlib.redirect_stdout(output):
            result, ok = m.run_with_exit_evidence(['docker', 'run', '--network=none', '--memory=1g', 'fixture-image'], b'inert')
        return commands, output.getvalue(), result, ok

    def test_captures_exit_and_oom_before_exact_stopped_id_removal(self):
        commands, output, result, ok = self.scenario()
        self.assertTrue(ok)
        self.assertEqual([c[1] for c in commands], ['run', 'inspect', 'logs', 'rm'])
        self.assertEqual(commands[-1], ['docker', 'rm', 'a' * 64])
        self.assertIn('"OOMKilled": true', output)
        self.assertIn('--memory=1g', commands[0])
        self.assertIn('--network=none', commands[0])
        self.assertEqual(result.returncode, 1)

    def test_missing_cid_never_removes_a_container(self):
        commands, _, _, ok = self.scenario(cid=False)
        self.assertFalse(ok)
        self.assertEqual(len(commands), 1)

    def test_unknown_or_running_state_retains_container(self):
        for params in ({'running': True}, {'inspect_rc': 1}):
            commands, _, _, ok = self.scenario(**params)
            self.assertFalse(ok)
            self.assertNotIn('rm', [c[1] for c in commands])

    def test_timeout_keeps_failure_and_captures_stopped_state(self):
        commands, output, result, ok = self.scenario(timeout=True)
        self.assertFalse(ok)
        self.assertEqual(result.returncode, 124)
        self.assertIn('partial fixture stage', output)
        self.assertEqual(commands[-1][1], 'logs')
        self.assertNotIn('rm', [c[1] for c in commands])

    def test_full_plan_entrypoint_has_one_cleanup_strategy_and_no_runtime_calls(self):
        output = io.StringIO()
        with patch.object(sys, 'argv', ['run.py']), contextlib.redirect_stdout(output), \
             patch.object(m.subprocess, 'run', side_effect=AssertionError('plan called subprocess')), \
             patch.object(m.subprocess, 'check_output', side_effect=AssertionError('plan queried runtime')):
            self.assertEqual(m.main(), 0)
        plan = json.loads(output.getvalue())
        self.assertFalse(plan['executing'])
        self.assertNotIn('--rm', plan['command'])
        for boundary in ('--network=none', '--cap-drop=ALL', '--read-only', '--memory=1g', '--memory-swap=1g'):
            self.assertIn(boundary, plan['command'])


if __name__ == '__main__':
    unittest.main()

"""Check environment gating, shell preservation, and exact alias arguments."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aliases', root / 'scripts/setup-agent-aliases.py')
aliases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aliases)


class AliasTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        self.enterContext(patch.dict(os.environ, {'HOME': str(self.home), 'DEVCONTAINER': '1', 'XDG_CONFIG_HOME': str(self.home / '.config')}))

    def test_install_preserves_and_repeats(self):
        rc = self.home / '.bashrc'
        rc.write_text('# Existing settings\n')
        aliases.configure()
        first = rc.read_text()
        aliases.configure()
        self.assertEqual(rc.read_text(), first)
        self.assertTrue(first.startswith('# Existing settings\n'))
        self.assertIn('devcontainer-agents.sh', (self.home / '.zshrc').read_text())

    def test_fish_install_and_xdg(self):
        with patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.home / 'xdg')}):
            aliases.configure()
        installed = self.home / 'xdg/fish/conf.d/dotai-agent-aliases.fish'
        self.assertEqual(installed.read_text(), (root / 'shell/devcontainer-agents.fish').read_text())

    def test_fish_arguments(self):
        body = '''function codex; printf '<%s>\\n' $argv; end
function claude; printf '<%s>\\n' $argv; end
source $argv[1]
cx 'two words'
cc --continue
'''
        result = subprocess.run(['fish', '--no-config', '-c', body, str(root / 'shell/devcontainer-agents.fish')], text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout, '<--sandbox>\n<danger-full-access>\n<--ask-for-approval>\n<on-request>\n<two words>\n<--permission-mode>\n<default>\n<--settings>\n<{"sandbox":{"enabled":false}}>\n<--continue>\n')

    def test_fish_host_leaves_functions_unchanged(self):
        body = "function cx; echo original; end; source $argv[1]; cx; not functions -q cc"
        env = dict(os.environ)
        env.pop('DEVCONTAINER', None)
        result = subprocess.run(['fish', '--no-config', '-c', body, str(root / 'shell/devcontainer-agents.fish')], env=env, text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout, 'original\n')

    def test_host_install_noop(self):
        with patch.dict(os.environ, {'DEVCONTAINER': ''}):
            aliases.configure()
        self.assertEqual(list(self.home.iterdir()), [])

    def shell(self, body, devcontainer):
        env = dict(os.environ, DEVCONTAINER=devcontainer)
        return subprocess.run(['bash', '--noprofile', '--norc', '-c', body, 'test', str(root / 'shell/devcontainer-agents.sh')], env=env, text=True, capture_output=True, check=True).stdout

    def test_host_source_preserves_existing_alias(self):
        result = self.shell('alias cx="original"\n. "$1"\nalias cx\n! alias cc 2>/dev/null', '')
        self.assertIn("cx='original'", result)

    def test_exact_arguments_and_forwarding(self):
        result = self.shell('''shopt -s expand_aliases
codex() { printf '<%s>\\n' "$@"; }
claude() { printf '<%s>\\n' "$@"; }
. "$1"
cx "two words"
cc --continue
''', '1')
        self.assertEqual(result, '<--sandbox>\n<danger-full-access>\n<--ask-for-approval>\n<on-request>\n<two words>\n<--permission-mode>\n<default>\n<--settings>\n<{"sandbox":{"enabled":false}}>\n<--continue>\n')


if __name__ == '__main__':
    unittest.main()

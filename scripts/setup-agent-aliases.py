#!/usr/bin/env python3
"""Wire devcontainer-only personal agent aliases into Bash, Zsh, and Fish."""
import os
from pathlib import Path
import shlex


def configure():
    if os.environ.get("DEVCONTAINER") != "1":
        print("Not a devcontainer; shell configuration unchanged")
        return
    source = Path(__file__).resolve().parents[1] / 'shell/devcontainer-agents.sh'
    marker = '# dotai: devcontainer agent aliases'
    block = f'{marker}\n[ "${{DEVCONTAINER:-}}" != "1" ] || . {shlex.quote(str(source))}\n'
    # Validate the shared refusal condition before changing any shell config.
    fish_source = source.with_suffix('.fish')
    config_home = Path(os.environ.get('XDG_CONFIG_HOME') or str(Path.home() / '.config'))
    fish_config = config_home / 'fish/conf.d/dotai-agent-aliases.fish'
    if fish_config.exists() and marker not in fish_config.read_text():
        raise SystemExit(f'Refusing to overwrite unmanaged Fish config: {fish_config}')
    for name in ('.bashrc', '.zshrc'):
        rc = Path.home() / name
        original = rc.read_text() if rc.exists() else ''
        if marker in original:
            print(f'Agent aliases already wired: {rc}')
            continue
        with rc.open('a') as stream:
            stream.write('\n' + block)
        print(f'Agent aliases wired: {rc}')
    fish_config.parent.mkdir(parents=True, exist_ok=True)
    fish_config.write_text(fish_source.read_text())
    print(f'Agent shortcuts wired: {fish_config}')
    print(f'Open a new terminal. Fish: source {fish_source}; Bash/Zsh: source {source}')


if __name__ == '__main__':
    configure()

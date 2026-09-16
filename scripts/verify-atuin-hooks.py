#!/usr/bin/env python3
"""Exercise installed Atuin handlers with synthetic events in a temporary database.

This verifies registration and the handler protocol, not live agent dispatch or
Codex hook trust. No real shell history or agent settings are changed.
"""
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import tempfile
import uuid


def main():
    registrations = {
        "claude-code": Path.home() / ".claude/settings.json",
        "codex": Path.home() / ".codex/hooks.json",
    }
    with tempfile.TemporaryDirectory(prefix="atuin-hook-check-") as temporary:
        root = Path(temporary)
        env = dict(os.environ)
        env.update(XDG_CONFIG_HOME=str(root / "config"),
                   XDG_DATA_HOME=str(root / "data"),
                   XDG_CACHE_HOME=str(root / "cache"),
                   ATUIN_SESSION=uuid.uuid4().hex, PWD=str(root))
        # Do not inherit path overrides or private-mode settings from a caller.
        for key in list(env):
            if key.startswith("ATUIN_") and key != "ATUIN_SESSION":
                del env[key]
        config = root / "config/atuin"
        config.mkdir(parents=True)
        (config / "config.toml").write_text("auto_sync = false\nupdate_check = false\n")
        for agent, path in registrations.items():
            settings = json.loads(path.read_text())
            handler = f"atuin hook {agent}"
            for event in ("PreToolUse", "PostToolUse", "PostToolUseFailure"):
                matches = [h for group in settings.get("hooks", {}).get(event, [])
                           for h in group.get("hooks", [])
                           if h.get("command") == handler]
                assert len(matches) == 1, (agent, event, "expected one native hook")
            for exit_code in (0, 7):
                marker = f"atuin-hook-check-{agent}-{uuid.uuid4().hex}"
                command = f"sh -c 'exit {exit_code}' # {marker}"
                payload = dict(tool_name="Bash", tool_use_id=uuid.uuid4().hex,
                               session_id=env["ATUIN_SESSION"], cwd=str(root),
                               tool_input=dict(command=command,
                                               description="Synthetic Atuin handler verification"))
                def dispatch(event):
                    payload["hook_event_name"] = event
                    subprocess.run(shlex.split(handler), input=json.dumps(payload),
                                   text=True, env=env, cwd=root, check=True)
                dispatch("PreToolUse")
                result = subprocess.run(["sh", "-c", command], cwd=root, env=env)
                assert result.returncode == exit_code
                payload["tool_response"] = {"exitCode": result.returncode}
                dispatch("PostToolUse")
                db = sqlite3.connect(root / "data/atuin/history.db")
                row = db.execute("SELECT exit, duration, author, intent, cwd FROM history WHERE command = ?",
                                 (command,)).fetchone()
                db.close()
                assert row and row[0] == exit_code and row[1] >= 0 and row[2] == agent, row
                assert row[3] == "Synthetic Atuin handler verification" and row[4] == str(root), row
                found = subprocess.run(["atuin", "search", "--author", "$all-agent",
                                        "--cmd-only", marker], env=env, cwd=root,
                                       check=True, capture_output=True, text=True)
                assert command in found.stdout, found.stdout
                print(f"PASS {agent}: command, exit={exit_code}, duration, author, intent")
            # Handler failure events use generic exit=1, not the process status.
            payload["tool_use_id"] = uuid.uuid4().hex
            payload["tool_input"]["command"] = f"true # failure-event-{uuid.uuid4().hex}"
            dispatch("PreToolUse")
            dispatch("PostToolUseFailure")
            db = sqlite3.connect(root / "data/atuin/history.db")
            row = db.execute("SELECT exit FROM history WHERE command = ?",
                             (payload["tool_input"]["command"],)).fetchone()
            db.close()
            assert row == (1,), row
            print(f"PASS {agent}: PostToolUseFailure records exit=1")
    print("PASS: temporary history removed; live agent dispatch still requires a fresh session.")


if __name__ == "__main__":
    main()

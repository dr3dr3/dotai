#!/usr/bin/env python3
"""Wire the Pi harness: persist its agent dir, merge committed providers, store the gateway key.

Three idempotent steps, each safe to re-run:

1. Persist ``~/.pi/agent`` on the ``~/.ai`` volume (``~/.ai/pi``) so models.json,
   auth.json, sessions and extensions survive a devcontainer rebuild. Mirrors
   persist-codex.py: only when ``~/.ai`` is a mount; existing content migrates
   without overwriting anything already on the volume.
2. Merge the committed, non-secret providers from
   ``sandbox/profiles/config/pi/models.json`` into the live models.json.
   Provider-level fields are overwritten; ``models`` are upserted by id, so the
   generated Ollama list (scripts/pi-ollama-models.py) is never clobbered.
3. Store the Vercel AI Gateway key in Pi's auth.json (0600). Sources, in
   order: ``AI_GATEWAY_API_KEY`` in the environment; local-dev-env's injected
   tooling secrets (``~/.config/roe/tooling.env``, written by ``make tool-auth``
   from ``env/tooling.template.env`` per ADR-2026-09-14-1 — the normal path in
   the RoE devcontainer); a direct ``op read`` for machines with an in-container
   1Password. A file beats an env var here because the Firstmate nono profiles
   strip ``*_API_KEY`` from worker environments. Skips gracefully when no
   source has it.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_pi_common import load_json, write_json_atomic  # noqa: E402

DOTAI_DIR = Path(__file__).resolve().parent.parent
COMMITTED_MODELS = DOTAI_DIR / "sandbox" / "profiles" / "config" / "pi" / "models.json"
GATEWAY_PROVIDER = "vercel-ai-gateway"
GATEWAY_ENV = "AI_GATEWAY_API_KEY"
# Same reference local-dev-env's env/tooling.template.env declares for this key.
DEFAULT_OP_REF = "op://ROE - CTO/Vercel AI Gateway/credential"
DEFAULT_TOOLING_ENV = Path.home() / ".config" / "roe" / "tooling.env"
DEFAULT_MODEL = ("vercel-ai-gateway", "deepseek/deepseek-v4.1-flash")


def log(message):
    print(message, flush=True)


# ---------------------------------------------------------------------------
# 1. Persistence
# ---------------------------------------------------------------------------
def active_writers(source):
    """True if any process of ours holds a file under ``source`` open."""
    prefix = str(source.resolve()) + "/"
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            for fd in (proc / "fd").iterdir():
                try:
                    if str(fd.readlink()).startswith(prefix):
                        return True
                except (FileNotFoundError, PermissionError):
                    pass
        except (FileNotFoundError, PermissionError):
            pass
    return False


def migrate_tree(source, target, stamp):
    """Move source's content into target without overwriting what target has.

    Files that already exist on both sides with different content are kept on
    the volume; the container-side copy is parked as ``<name>.pre-persistence.<stamp>``
    next to the volume copy. A symlink from source into target (the shape the
    host-side Ollama script produced) is simply dropped.
    """
    for entry in sorted(source.iterdir()):
        dest = target / entry.name
        if entry.is_symlink():
            if entry.resolve() == dest.resolve():
                entry.unlink()
                continue
            if not dest.exists() and not dest.is_symlink():
                shutil.move(str(entry), str(dest))
                continue
            entry.rename(target / f"{entry.name}.pre-persistence.{stamp}")
            continue
        if entry.is_dir():
            if dest.is_dir():
                migrate_tree(entry, dest, stamp)
                entry.rmdir()
            else:
                shutil.move(str(entry), str(dest))
            continue
        if dest.exists():
            if dest.read_bytes() == entry.read_bytes():
                entry.unlink()
            else:
                entry.rename(target / f"{entry.name}.pre-persistence.{stamp}")
        else:
            shutil.move(str(entry), str(dest))


def persist(agent_dir, volume):
    target = volume / "pi"
    if agent_dir.is_symlink():
        if agent_dir.resolve() == target.resolve():
            log(f"✓ Pi agent dir already persisted at {target}")
            return target
        raise SystemExit(f"✖ {agent_dir} is a symlink to {agent_dir.resolve()}, not {target}; resolve manually")
    if agent_dir.exists() and not agent_dir.is_dir():
        raise SystemExit(f"✖ {agent_dir} exists and is not a directory")
    if agent_dir.is_dir() and active_writers(agent_dir):
        raise SystemExit(f"✖ a process still has files open under {agent_dir}; exit Pi and re-run")
    target.mkdir(parents=True, exist_ok=True)
    if agent_dir.is_dir():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        migrate_tree(agent_dir, target, stamp)
        agent_dir.rmdir()
        log(f"→ Migrated existing {agent_dir} onto the volume")
    agent_dir.parent.mkdir(parents=True, exist_ok=True)
    agent_dir.symlink_to(target)
    log(f"✓ Pi agent dir persisted: {agent_dir} → {target}")
    return target


# ---------------------------------------------------------------------------
# 2. Committed providers → live models.json
# ---------------------------------------------------------------------------
def merge_provider(live, committed):
    merged = dict(live)
    for key, value in committed.items():
        if key != "models":
            merged[key] = value
    if "models" in committed:
        models = [dict(m) for m in live.get("models", [])]
        index = {m.get("id"): i for i, m in enumerate(models)}
        for definition in committed["models"]:
            if definition.get("id") in index:
                models[index[definition["id"]]] = definition
            else:
                models.append(definition)
        merged["models"] = models
    return merged


def merge_models(live_path, committed_path):
    committed = load_json(committed_path, allow_comments=True)
    if live_path.exists():
        try:
            live = load_json(live_path, allow_comments=True)
        except ValueError as error:
            raise SystemExit(f"✖ {live_path} is not valid JSON ({error}); refusing to overwrite it")
    else:
        live = {"providers": {}}
    providers = dict(live.get("providers", {}))
    for name, config in committed.get("providers", {}).items():
        providers[name] = merge_provider(providers.get(name, {}), config)
    updated = dict(live)
    updated["providers"] = providers
    if live_path.exists() and updated == live:
        log(f"✓ {live_path} already carries the committed providers")
        return False
    write_json_atomic(live_path, updated)
    log(f"✓ Merged committed providers into {live_path}: {', '.join(committed['providers'])}")
    return True


def seed_default_model(settings_path):
    settings = load_json(settings_path, allow_comments=True) if settings_path.exists() else {}
    if settings.get("defaultProvider") or settings.get("defaultModel"):
        return False
    settings["defaultProvider"], settings["defaultModel"] = DEFAULT_MODEL
    write_json_atomic(settings_path, settings)
    log(f"✓ Default Pi model set to {DEFAULT_MODEL[0]}/{DEFAULT_MODEL[1]} (change with /model)")
    return True


# ---------------------------------------------------------------------------
# 3. Gateway key → auth.json
# ---------------------------------------------------------------------------
def read_env_file_value(path, name):
    """Value of ``name`` in a KEY=value file (last wins; quotes stripped), or None."""
    if not path.is_file():
        return None
    value = None
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        if line.startswith(f"{name}="):
            value = line[len(name) + 1:].strip().strip("'\"")
    return value or None


def resolve_gateway_key(env=os.environ):
    key = env.get(GATEWAY_ENV, "").strip()
    if key:
        return key, f"${GATEWAY_ENV}"
    tooling_env = Path(env.get("ROE_TOOLING_ENV", DEFAULT_TOOLING_ENV))
    key = read_env_file_value(tooling_env, GATEWAY_ENV)
    if key:
        return key, f"{tooling_env} (make tool-auth)"
    if not shutil.which("op"):
        return None, f"not in {tooling_env} and op not installed"
    ref = env.get("AI_GATEWAY_OP_REF", DEFAULT_OP_REF)
    account = env.get("OP_ACCOUNT", "my.1password.com")
    result = subprocess.run(
        ["op", "read", "--account", account, ref],
        capture_output=True, text=True, check=False,
    )
    key = result.stdout.strip()
    if result.returncode == 0 and key:
        return key, f"1Password {ref}"
    detail = (result.stderr or "").strip().splitlines()
    return None, f"op read {ref} failed: {detail[0] if detail else 'no output'}"


def store_gateway_key(auth_path, key):
    auth = load_json(auth_path) if auth_path.exists() and auth_path.stat().st_size else {}
    current = auth.get(GATEWAY_PROVIDER, {})
    if current.get("type") == "api_key" and current.get("key") == key:
        os.chmod(auth_path, 0o600)
        return False
    auth[GATEWAY_PROVIDER] = {"type": "api_key", "key": key}
    write_json_atomic(auth_path, auth, mode=0o600)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent-dir", type=Path,
                        default=Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi" / "agent")),
                        help="Pi agent dir (default: $PI_CODING_AGENT_DIR or ~/.pi/agent)")
    parser.add_argument("--volume", type=Path, default=Path.home() / ".ai",
                        help="persistent volume; persistence is skipped unless this is a mount")
    parser.add_argument("--committed-models", type=Path, default=COMMITTED_MODELS)
    parser.add_argument("--no-key", action="store_true", help="skip the gateway key step")
    args = parser.parse_args()

    agent_dir = args.agent_dir.expanduser().absolute()
    if args.volume.is_mount() or os.environ.get("PI_SETUP_FORCE_VOLUME") == "1":
        persist(agent_dir, args.volume)
    else:
        log(f"AI volume {args.volume} not mounted; leaving Pi at {agent_dir} (not persisted)")
        agent_dir.mkdir(parents=True, exist_ok=True)

    merge_models(agent_dir / "models.json", args.committed_models)
    seed_default_model(agent_dir / "settings.json")

    if args.no_key:
        return
    key, source = resolve_gateway_key()
    if key is None:
        log(f"⚠ Vercel AI Gateway key not stored ({source}). Pi still works for Ollama;")
        log(f"  in the RoE devcontainer run `make tool-auth` (needs {DEFAULT_OP_REF} readable),")
        log(f"  or set {GATEWAY_ENV}, then re-run.")
        return
    if store_gateway_key(agent_dir / "auth.json", key):
        log(f"✓ Vercel AI Gateway key stored in {agent_dir / 'auth.json'} (from {source})")
    else:
        log(f"✓ Vercel AI Gateway key already current in {agent_dir / 'auth.json'}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Persist Codex on the existing AI volume; migrate only with writers stopped."""
import argparse
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile


def copy_state(source, target):
    def ignore(directory, names):
        return [name for name in names if name.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm"))
                or (Path(directory) / name).is_socket()]
    shutil.copytree(source, target, symlinks=True, dirs_exist_ok=True, ignore=ignore)
    for db in source.rglob("*.sqlite"):
        destination = target / db.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
                if dst.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise RuntimeError(f"Invalid database backup: {destination.name}")


def active_writers(source):
    # Include app-server and custom executable names: inspect actual open files.
    prefix = str(source.resolve()) + "/"
    for proc in Path("/proc").glob("[0-9]*"):
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            if "codex" in (proc / "comm").read_text().lower():
                return True
            for fd in (proc / "fd").iterdir():
                try:
                    if str(fd.readlink()).startswith(prefix):
                        return True
                except (FileNotFoundError, PermissionError):
                    pass
        except (FileNotFoundError, PermissionError):
            # Some unrelated setuid/dump-protected processes hide their FDs.
            # Codex processes were checked by name before inspecting descriptors.
            pass
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", action="store_true", help="Consistent SQLite backup without relocating live state")
    args = parser.parse_args()
    home = Path.home()
    volume = home / ".ai"
    if not volume.is_mount():
        print("AI volume not mounted; leaving Codex at its normal location")
        return
    source = Path(os.environ.get("CODEX_HOME", str(home / ".codex"))).absolute()
    target = volume / "codex"
    if source.resolve() == target.resolve():
        print("Codex already uses the AI volume")
        return
    if source.is_symlink():
        raise SystemExit(f"Custom Codex symlink preserved: {source}; configure its target persistence separately")
    if args.snapshot:
        if not source.is_dir():
            raise SystemExit("No Codex state to snapshot")
        backups = volume / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        snapshot = Path(tempfile.mkdtemp(prefix="codex-", dir=backups))
        copy_state(source, snapshot)
        print(f"Codex snapshot: {snapshot} (live files can continue changing)")
        return
    if source.exists():
        if active_writers(source):
            raise SystemExit("Codex has open files. Exit all Codex clients/app servers, then run python3 /workspace/.ai/dotai/scripts/persist-codex.py before rebuilding.")
        if target.exists():
            raise SystemExit(f"Both {source} and {target} exist; refusing to merge independent histories")
        backup = source.with_name(source.name + ".pre-persistence")
        if backup.exists():
            raise SystemExit(f"Rollback path already exists: {backup}")
        staging = Path(tempfile.mkdtemp(prefix=".codex-migrate-", dir=volume))
        copy_state(source, staging)
        staging.rename(target)
        # Keep the original as a rollback copy; never delete session data.
        source.rename(backup)
    else:
        target.mkdir(mode=0o700, exist_ok=True)
    source.parent.mkdir(parents=True, exist_ok=True)
    source.symlink_to(target, target_is_directory=True)
    print(f"Codex persisted: {source} -> {target}")


if __name__ == "__main__":
    main()

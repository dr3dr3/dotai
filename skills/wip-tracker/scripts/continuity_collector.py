#!/usr/bin/env python3
"""C2 trusted, bounded filesystem collector. No launch, polling or live setup.

The operator supplies a binding; a child can only contribute JSON in its granted
outbox and read receipts in its separate inbox. The collector and DB stay outside
child grants. This is not authentication against a compromised host owner.
"""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import stat
import sqlite3
import sys
from uuid import uuid4

from continuity import Error, MAX_BYTES, Store, canonical, fields, integer, require, uid


ALLOWED = {"checkpoint", "prepare", "send", "clarify", "accept", "cancel"}


@contextmanager
def directory(path):
    """Walk with directory FDs so no path component can redirect through a link."""
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "unsafe_path", "Absolute non-traversing directory required")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
                "unsafe_path", "Channel directory must be owner-held 0700")
        yield fd
    finally:
        os.close(fd)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "invalid", "Duplicate JSON key")
        result[key] = value
    return result


def read_json(fd, name):
    require("/" not in name and name not in (".", ".."), "unsafe_path", "Simple filename required")
    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        before = os.fstat(file_fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid()
                and stat.S_IMODE(before.st_mode) == 0o600, "unsafe_file", "Owner-held single-link regular 0600 file required")
        require(before.st_size <= MAX_BYTES, "invalid", "Event exceeds 64 KiB")
        data = bytearray()
        while len(data) <= MAX_BYTES:
            block = os.read(file_fd, min(8192, MAX_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(file_fd)
        require(len(data) <= MAX_BYTES and (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), "unstable", "Event changed while being read")
        return json.loads(data, object_pairs_hook=unique_object)
    finally:
        os.close(file_fd)


def publish(fd, name, value):
    """Atomic durable receipt. Never writes through a child-supplied symlink."""
    temporary = ".receipt-" + str(uuid4())
    file_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(file_fd, "w") as stream:
            stream.write(canonical(value) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=fd)
        except FileNotFoundError:
            pass


def binding_file(path):
    path = Path(path)
    with directory(path.parent) as fd:
        return read_json(fd, path.name)


class Collector:
    def __init__(self, store, binding):
        fields(binding, ("version", "session", "producer", "outbox", "inbox", "grants"))
        require(binding["version"] == 1, "invalid", "Unsupported channel binding")
        uid(binding["session"])
        require(isinstance(binding["producer"], str) and binding["producer"].strip(), "invalid", "Stable producer required")
        require(binding["outbox"] != binding["inbox"], "unsafe_path", "Outbox and receipt inbox must be separate")
        outbox, inbox = Path(binding["outbox"]), Path(binding["inbox"])
        require(outbox.is_absolute() and inbox.is_absolute() and ".." not in outbox.parts and ".." not in inbox.parts,
                "unsafe_path", "Absolute non-traversing channels required")
        require(not outbox.is_relative_to(inbox) and not inbox.is_relative_to(outbox)
                and not store.path.is_relative_to(outbox) and not store.path.is_relative_to(inbox),
                "unsafe_path", "Channel grants must not include each other or the database")
        require(isinstance(binding["grants"], list) and 0 < len(binding["grants"]) <= 20, "invalid", "Bounded assignment grants required")
        seen = set()
        for grant in binding["grants"]:
            fields(grant, ("thread", "assignment_revision"), ("handoff", "handoff_revision"))
            uid(grant["thread"])
            integer(grant["assignment_revision"])
            require(grant["thread"] not in seen, "invalid", "Duplicate thread grant")
            seen.add(grant["thread"])
            require(("handoff" in grant) == ("handoff_revision" in grant), "invalid", "Exact handoff revision required")
            if "handoff" in grant:
                uid(grant["handoff"])
                integer(grant["handoff_revision"], 1)
            store.get("threads", grant["thread"])
        store.get("sessions", binding["session"])
        self.store, self.binding = store, binding

    def authorize(self, event):
        fields(event, ("id", "sequence", "kind", "subject", "time", "payload"))
        require(event["kind"] in ALLOWED, "forbidden", "Event family not granted; feedback remains disabled")
        require(isinstance(event["payload"], dict), "invalid", "Expected event payload")
        p = event["payload"]
        h = None
        if event["kind"] in ("checkpoint", "prepare"):
            thread_id = p.get("thread")
        else:
            h = self.store.get("handoffs", event["subject"])
            thread_id = h["thread"]
        grants = [g for g in self.binding["grants"] if g["thread"] == thread_id]
        require(len(grants) == 1, "forbidden", "Thread not granted to this channel")
        grant = grants[0]
        t = self.store.get("threads", thread_id)
        session = self.binding["session"]
        if event["kind"] in ("accept", "clarify"):
            require(h["id"] == grant.get("handoff") and h["revision"] == grant.get("handoff_revision")
                    and h["receiver"] == session and h["previous_assignment"] == grant["assignment_revision"],
                    "forbidden", "Receiver channel lacks exact handoff grant")
        else:
            expected_assignment = grant["assignment_revision"]
            if "handoff" in grant:
                accepted = self.store.get("handoffs", grant["handoff"])
                require(accepted["revision"] == grant["handoff_revision"] and accepted["state"] == "accepted"
                        and accepted["receiver"] == session, "forbidden", "Receiver has not accepted its granted handoff")
                expected_assignment = accepted["acceptance"]["assignment_revision"]
            require(t["coordinator"] == session and t["assignment_revision"] == expected_assignment,
                    "forbidden", "Channel assignment is stale")

    def collect(self, limit=50):
        integer(limit, 1)
        require(limit <= 200, "invalid", "Batch limit is 200")
        results = []
        with directory(self.binding["outbox"]) as outbox, directory(self.binding["inbox"]) as inbox:
            names = []
            with os.scandir(outbox) as entries:
                for entry in entries:
                    if not entry.name.endswith(".json"):
                        continue
                    names.append(entry.name)
                    require(len(names) <= 200, "limit", "Outbox exceeds 200 pending JSON files; bounded operator cleanup required")
            pending = []
            for name in names:
                try:
                    uid(name[:-5])
                    event = read_json(outbox, name)
                    require(event.get("id") == name[:-5], "invalid", "Filename must match event UUID")
                    require(event.get("kind") in ALLOWED, "forbidden", "Unsupported event; not persisted")
                    integer(event.get("sequence"))
                    pending.append((event["sequence"], name, event, None))
                except (Error, OSError, ValueError, TypeError, AttributeError) as exc:
                    pending.append((float("inf"), name, None,
                                    {"event": name[:-5], "committed": False, "ok": False,
                                     "code": getattr(exc, "code", "invalid_file")}))
            # UUID filenames are not delivery order. Respect this bound producer's
            # sequence when a batch contains dependent checkpoints/transitions.
            for _, name, event, failure in sorted(pending, key=lambda p: (p[0], p[1]))[:limit]:
                try:
                    # Authorization and apply share the immediate transaction via
                    # the Store's precommit validator: no race with handoff change.
                    if failure:
                        receipt = failure
                    else:
                        result = self.store.apply(event, {"producer": self.binding["producer"], "kind": "session",
                                                         "session": self.binding["session"]}, authorize=self.authorize)
                        receipt = {"event": event["id"], "committed": True, "ok": result["ok"],
                                   "code": "accepted" if result["ok"] else result["error"]["code"]}
                except (Error, sqlite3.Error, ValueError, TypeError) as exc:
                    receipt = {"event": name[:-5], "committed": False, "ok": False,
                               "code": getattr(exc, "code", "storage_error" if isinstance(exc, sqlite3.Error) else "invalid")}
                # If publishing fails, no ACK is returned; retry replays the same
                # committed event. Never unlink an untrusted concurrently replaced
                # source file. The producer removes it after reading its receipt.
                publish(inbox, name, receipt)
                results.append(receipt)
        return results


def instructions(binding):
    """Personal text for the trusted launcher to load on intake AND direct entry."""
    return f"""# Continuity contribution channel

Your stable session is {binding['session']}. Your trusted launcher supplied the
work/assignment context separately. Read that context before substantive work.
Write one UTF-8 JSON event atomically to {binding['outbox']}/EVENT_UUID.json with
mode 0600. Allowed kinds: checkpoint, prepare, send, clarify, accept, cancel.
Use the exact supplied thread/assignment/handoff revisions. Each new event has
its own UUID and monotonically increasing producer sequence; retry unchanged.
Never invent provenance or grant yourself another thread. Accept the exact
received handoff before execution; transport delivery is not acceptance.

At meaningful transitions, checkpoint decisions, evidence, current position,
blockers/questions and concrete next actions. Separate required, waiting and
optional work; label proposed actors. A disappeared session does not finish work.
Receipt files are in {binding['inbox']}/EVENT_UUID.json. Claim durable acceptance
only after committed=true AND ok=true. A missing receipt is unknown: retain the
event. Correct a rejected contribution using fresh context and a new event UUID.
After acknowledgement, remove that exact unchanged outbox event. Do not edit
receipts, inspect the continuity database, launch agents, or infer runtime authority.
Feedback capture and feedback prompts remain disabled. Continue directly with André.
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--binding", required=True, help="Trusted owner-held JSON, outside child grants")
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    store = None
    try:
        store = Store(args.db)
        result = Collector(store, binding_file(args.binding)).collect(args.limit)
        print(canonical({"ok": all(r["ok"] for r in result), "receipts": result}))
        return 0 if all(r["ok"] for r in result) else 2
    except (Error, OSError, sqlite3.Error, ValueError) as exc:
        print(canonical({"ok": False, "error": getattr(exc, "code", "collector_failed")}))
        return 2
    finally:
        if store:
            store.close()


if __name__ == "__main__":
    sys.exit(main())

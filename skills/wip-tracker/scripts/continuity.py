#!/usr/bin/env python3
"""C1 local continuity store. Trusted operator API; no live adapters or launches."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile
from datetime import datetime, timezone
from uuid import UUID, uuid4

from continuity_feedback import SCHEMA as FEEDBACK_SCHEMA


VERSION = 2
MAX_BYTES = 65536
SCHEMA = """
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, environment TEXT NOT NULL, launch_attempt TEXT NOT NULL,
 provider TEXT, provider_id TEXT, body TEXT NOT NULL,
 UNIQUE(environment, launch_attempt), UNIQUE(environment, provider, provider_id)
);
CREATE TABLE threads (
 id TEXT PRIMARY KEY, coordinator TEXT NOT NULL REFERENCES sessions(id),
 checkpoint TEXT REFERENCES checkpoints(id), outcome TEXT REFERENCES outcomes(id),
 origin TEXT REFERENCES threads(id), body TEXT NOT NULL
);
CREATE TABLE outcomes (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), body TEXT NOT NULL
);
CREATE TABLE outcome_scopes (
 id TEXT NOT NULL REFERENCES outcomes(id), revision INTEGER NOT NULL,
 body TEXT NOT NULL, PRIMARY KEY(id, revision)
);
CREATE TABLE checkpoints (
 id TEXT PRIMARY KEY, thread TEXT NOT NULL REFERENCES threads(id),
 author TEXT NOT NULL REFERENCES sessions(id), body TEXT NOT NULL
);
CREATE TABLE handoffs (
 id TEXT NOT NULL, revision INTEGER NOT NULL,
 thread TEXT NOT NULL REFERENCES threads(id),
 sender TEXT NOT NULL REFERENCES sessions(id), receiver TEXT NOT NULL REFERENCES sessions(id),
 body TEXT NOT NULL, PRIMARY KEY(id, revision)
);
CREATE TABLE engagements (
 id TEXT PRIMARY KEY, thread TEXT NOT NULL REFERENCES threads(id),
 revision INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(thread, revision)
);
CREATE TABLE launch_requests (
 id TEXT PRIMARY KEY, thread TEXT NOT NULL REFERENCES threads(id), body TEXT NOT NULL
);
CREATE TABLE events (
 id TEXT PRIMARY KEY, producer TEXT NOT NULL, sequence INTEGER NOT NULL,
 kind TEXT NOT NULL, subject TEXT NOT NULL, event_time TEXT NOT NULL,
 receipt_time TEXT NOT NULL, payload_hash TEXT NOT NULL, body TEXT NOT NULL,
 result TEXT NOT NULL, UNIQUE(producer, sequence)
);
CREATE INDEX handoffs_thread ON handoffs(thread);
CREATE INDEX checkpoints_thread ON checkpoints(thread);
CREATE INDEX engagements_thread ON engagements(thread);
PRAGMA user_version = 2;
"""
SCHEMA += FEEDBACK_SCHEMA


class Error(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise Error(code, message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def fields(value, required, optional=()):
    require(isinstance(value, dict), "invalid", "Expected an object")
    require(set(required) <= value.keys() <= set(required) | set(optional),
            "invalid", "Missing or unrecognised fields")


def nonempty(value):
    require(isinstance(value, str) and bool(value.strip()), "invalid", "Expected nonempty text")


def uid(value):
    try:
        require(isinstance(value, str) and str(UUID(value)) == value, "invalid", "Expected canonical UUID")
    except (ValueError, AttributeError):
        raise Error("invalid", "Expected canonical UUID") from None


def integer(value, minimum=0):
    require(type(value) is int and value >= minimum, "invalid", "Expected nonnegative integer")


def timestamp(value):
    nonempty(value)
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(result.utcoffset() is not None, "invalid", "Timestamp needs timezone")
        return result
    except ValueError:
        raise Error("invalid", "Expected ISO timestamp") from None


def strings(value):
    require(isinstance(value, list), "invalid", "Expected text array")
    for item in value:
        nonempty(item)


def links(value):
    require(isinstance(value, list), "invalid", "Expected typed links")
    for item in value:
        fields(item, ("type", "ref"))
        nonempty(item["type"])
        nonempty(item["ref"])


def interaction(mode, exit_condition):
    require(mode in ("collaboration", "facilitation", "service"), "invalid", "Bad interaction mode")
    nonempty(exit_condition)


def semantic(value):
    fields(value, ("position", "decisions", "evidence", "questions", "blockers"),
           ("next_action", "actions", "observations", "conditions", "scope_revision", "engagement_exit"))
    nonempty(value["position"])
    require("actions" in value or "next_action" in value, "invalid", "Actions or legacy next_action required")
    if "next_action" in value:
        nonempty(value["next_action"])
    if "actions" in value:
        require(isinstance(value["actions"], list), "invalid", "Expected actions array")
        for action in value["actions"]:
            fields(action, ("id", "text", "category", "actor", "destination", "dependencies", "evidence", "contribution"))
            for key in ("id", "text", "contribution"):
                nonempty(action[key])
            require(action["category"] in ("required-now", "waiting", "optional-follow-up", "separate-opportunity"), "invalid", "Bad action category")
            fields(action["actor"], ("status", "name", "evidence"))
            require(action["actor"]["status"] in ("confirmed", "proposed", "unknown"), "invalid", "Bad actor status")
            if action["actor"]["status"] == "unknown":
                require(action["actor"]["name"] is None, "invalid", "Unknown actor cannot name an owner")
            else:
                nonempty(action["actor"]["name"])
            links(action["actor"]["evidence"])
            require(action["actor"]["status"] != "confirmed" or bool(action["actor"]["evidence"]), "invalid", "Confirmed actor needs assignment evidence")
            fields(action["destination"], ("status", "session"))
            require(action["destination"]["status"] in ("verified", "unknown"), "invalid", "Bad destination status")
            if action["destination"]["status"] == "verified":
                uid(action["destination"]["session"])
            else:
                require(action["destination"]["session"] is None, "invalid", "Unknown destination must be null")
            strings(action["dependencies"])
            links(action["evidence"])
        ids = [a["id"] for a in value["actions"]]
        require(len(ids) == len(set(ids)), "invalid", "Duplicate action IDs")
    require(isinstance(value.get("observations", []), list), "invalid", "Expected observations")
    for observation in value.get("observations", []):
        fields(observation, ("key", "claim", "observed_at", "source", "status"),
               ("blocks", "hold_reason", "release_condition"))
        nonempty(observation["key"])
        nonempty(observation["claim"])
        timestamp(observation["observed_at"])
        links([observation["source"]])
        require(observation["status"] in ("supported", "unknown", "contradicted"), "invalid", "Bad evidence status")
        if "blocks" in observation:
            require(type(observation["blocks"]) is bool, "invalid", "Expected dependency boolean")
        if "hold_reason" in observation or "release_condition" in observation:
            nonempty(observation.get("hold_reason"))
            nonempty(observation.get("release_condition"))
    require(isinstance(value.get("conditions", []), list), "invalid", "Expected condition updates")
    if value.get("conditions"):
        integer(value.get("scope_revision"), 1)
    for condition in value.get("conditions", []):
        fields(condition, ("id", "state", "evidence", "remaining"))
        nonempty(condition["id"])
        require(condition["state"] in ("met", "gap", "unknown"), "invalid", "Bad condition interpretation")
        strings(condition["evidence"])
        require(condition["state"] != "met" or bool(condition["evidence"]), "invalid", "Met condition needs evidence")
        require(isinstance(condition["remaining"], str), "invalid", "Expected remaining explanation")
    for key in ("decisions", "questions", "blockers"):
        strings(value[key])
    links(value["evidence"])
    if "engagement_exit" in value:
        result = value["engagement_exit"]
        fields(result, ("revision", "assessment", "evidence", "remaining", "next_action"))
        integer(result["revision"], 1)
        require(result["assessment"] in ("met", "unmet", "unknown"), "invalid", "Bad engagement exit assessment")
        links(result["evidence"])
        require(result["assessment"] == "unknown" or bool(result["evidence"]),
                "invalid", "Exit assessment needs actual evidence")
        require(isinstance(result["remaining"], str), "invalid", "Expected remaining gap text")
        if result["assessment"] != "met":
            nonempty(result["remaining"])
            nonempty(result["next_action"])
        else:
            require(isinstance(result["next_action"], str), "invalid", "Expected next action text")


def private_path(path, creating=False):
    """Fail closed, never chmod an existing directory or follow a store symlink."""
    path = Path(path).absolute()
    for part in (path, *path.parents):
        require(not part.is_symlink(), "unsafe_path", "Symlink store paths are unsupported")
    if creating and not path.parent.exists():
        # Only the final directory may be created: operator selects its parent.
        path.parent.mkdir(mode=0o700)
    require(path.parent.is_dir(), "missing_store", "Store directory does not exist")
    info = path.parent.stat()
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "unsafe_path", "Store directory must be owned by you with mode 0700")
    if path.exists():
        info = path.stat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600,
                "unsafe_path", "Store must be your regular file with mode 0600")
    return path


class Store:
    @staticmethod
    def initialize(path):
        path = private_path(path, creating=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            raise Error("exists", "Store already exists; initialization never replaces it") from None
        os.close(fd)
        db = sqlite3.connect(path)
        try:
            db.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
            db.execute("INSERT INTO store_meta VALUES('store_id',?)", (str(uuid4()),))
            db.commit()
        finally:
            db.close()

    def __init__(self, path, readonly=False, _allow_snapshot=False):
        path = private_path(path)
        self.path = path
        require(path.exists(), "missing_store", "Explicit initialization required")
        self.db = sqlite3.connect(path.as_uri() + ("?mode=ro" if readonly else "?mode=rw"),
                                  uri=True, timeout=3, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=3000")
        self.db.execute("PRAGMA secure_delete=ON")
        try:
            require(self.db.execute("PRAGMA user_version").fetchone()[0] == VERSION,
                    "schema", "Unsupported schema version; no automatic migration")
            expected = sqlite3.connect(":memory:")
            try:
                expected.executescript(SCHEMA)
                query = "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"
                require([tuple(r) for r in self.db.execute(query)] == expected.execute(query).fetchall(),
                        "schema", "Schema differs from version 1")
            finally:
                expected.close()
            require(self.db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
                    and not self.db.execute("PRAGMA foreign_key_check").fetchall(),
                    "schema", "Corrupt continuity store")
            require(_allow_snapshot or self.db.execute("SELECT 1 FROM store_meta WHERE key='snapshot_time'").fetchone() is None,
                    "snapshot", "Sealed backup: restore through current deletion/expiry ledger before use")
            identity = self.db.execute("SELECT value FROM store_meta WHERE key='store_id'").fetchone()
            require(identity is not None, "schema", "Missing store lineage")
            uid(identity[0])
        except Exception:
            self.db.close()
            raise

    def close(self):
        self.db.close()

    def get(self, table, record_id, revision=None):
        require(table in ("sessions", "threads", "handoffs", "checkpoints", "launch_requests", "outcomes"),
                "invalid", "Unknown record family")
        sql = f"SELECT body FROM {table} WHERE id=?"
        args = [record_id]
        if table == "handoffs":
            if revision is not None:
                sql += " AND revision=?"
                args.append(revision)
            sql += " ORDER BY revision DESC LIMIT 1"
        row = self.db.execute(sql, args).fetchone()
        require(row is not None, "not_found", f"Missing {table} record")
        return json.loads(row[0])

    def engagement(self, thread_id, revision=None):
        sql = "SELECT body FROM engagements WHERE thread=?"
        args = [thread_id]
        if revision is not None:
            integer(revision, 1)
            sql += " AND revision=?"
            args.append(revision)
        row = self.db.execute(sql + " ORDER BY revision DESC LIMIT 1", args).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, table, body, **columns):
        values = {"id": body["id"], **columns, "body": canonical(body)}
        names = ",".join(values)
        marks = ",".join("?" for _ in values)
        self.db.execute(f"INSERT INTO {table} ({names}) VALUES ({marks})", list(values.values()))

    def update(self, table, body, **columns):
        values = {**columns, "body": canonical(body)}
        assignments = ",".join(f"{k}=?" for k in values)
        sql = f"UPDATE {table} SET {assignments} WHERE id=?"
        args = [*values.values(), body["id"]]
        if table == "handoffs":
            sql += " AND revision=?"
            args.append(body["revision"])
        self.db.execute(sql, args)

    def apply(self, event, actor, authorize=None):
        """actor is trusted channel metadata, never read from the event payload.

        C1 CLI is operator-only. C2 must bind this metadata via a verified collector.
        Accepted AND domain-rejected events are durable/idempotent. Malformed
        envelopes and replay collisions cannot acquire an event identity.
        """
        fields(actor, ("producer", "kind", "session"))
        nonempty(actor["producer"])
        require(actor["kind"] in ("operator", "launcher", "observer", "session"), "invalid", "Bad producer kind")
        if actor["session"] is not None:
            uid(actor["session"])
        require(actor["kind"] != "session" or actor["session"] is not None,
                "invalid", "Session channel must be bound")
        fields(event, ("id", "sequence", "kind", "subject", "time", "payload"))
        uid(event["id"])
        uid(event["subject"])
        integer(event["sequence"])
        nonempty(event["kind"])
        timestamp(event["time"])
        require(len(canonical(event).encode()) <= MAX_BYTES, "invalid", "Event exceeds 64 KiB")
        envelope = {"event": event, "actor": actor}
        payload_hash = digest(envelope)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            prior = self.db.execute("SELECT * FROM events WHERE id=? OR (producer=? AND sequence=?)",
                                    (event["id"], actor["producer"], event["sequence"])).fetchall()
            if prior:
                require(len(prior) == 1 and prior[0]["id"] == event["id"]
                        and prior[0]["payload_hash"] == payload_hash,
                        "replay_conflict", "Event ID or producer sequence reused with different content")
                self.db.execute("COMMIT")
                return json.loads(prior[0]["result"])
            self.db.execute("SAVEPOINT mutation")
            try:
                if authorize is not None:
                    authorize(event)
                result = {"ok": True, "value": self.dispatch(event, actor)}
            except (Error, sqlite3.IntegrityError) as exc:
                self.db.execute("ROLLBACK TO mutation")
                result = {"ok": False, "error": {"code": getattr(exc, "code", "conflict"),
                                                   "message": str(exc)}}
            self.db.execute("RELEASE mutation")
            self.db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (event["id"], actor["producer"], event["sequence"], event["kind"],
                             event["subject"], event["time"], now(), payload_hash,
                             canonical(envelope), canonical(result)))
            self.db.execute("COMMIT")
            return result
        except BaseException:
            if self.db.in_transaction:
                self.db.execute("ROLLBACK")
            raise

    def dispatch(self, event, actor):
        kind, p, subject = event["kind"], event["payload"], event["subject"]
        if kind == "register":
            require(actor["kind"] in ("operator", "launcher"), "forbidden", "Trusted registration required")
            fields(p, ("role", "environment", "launch_attempt", "profile", "identity"))
            for key in ("role", "environment", "profile"):
                nonempty(p[key])
            uid(p["launch_attempt"])
            identity = p["identity"]
            if identity is not None:
                fields(identity, ("provider", "session_id", "resume_ref", "evidence"))
                for value in identity.values():
                    nonempty(value)
            body = {"id": subject, **p, "revision": 0, "observation": None}
            prior = self.db.execute("SELECT body FROM sessions WHERE id=? OR (environment=? AND launch_attempt=?)",
                                    (subject, p["environment"], p["launch_attempt"])).fetchall()
            if prior:
                old = json.loads(prior[0][0])
                require(len(prior) == 1 and old["id"] == subject
                        and all(old[k] == p[k] for k in p), "conflict", "Registration differs from existing session")
                return old
            self.put("sessions", body, environment=p["environment"], launch_attempt=p["launch_attempt"],
                     provider=identity["provider"] if identity else None,
                     provider_id=identity["session_id"] if identity else None)
            return body
        if kind == "open":
            fields(p, ("title", "outcome", "links", "coordinator"), ("outcome_id", "origin"))
            nonempty(p["title"])
            nonempty(p["outcome"])
            links(p["links"])
            self.get("sessions", p["coordinator"])
            if p.get("outcome_id"):
                self.get("outcomes", p["outcome_id"])
            if p.get("origin"):
                self.get("threads", p["origin"])
            require(actor["kind"] == "operator" or (actor["kind"] == "session"
                    and actor["session"] == p["coordinator"]), "forbidden", "Cannot assign another session")
            body = {"id": subject, **p, "revision": 0, "assignment_revision": 0,
                    "engagement_revision": 0,
                    "disposition": "open", "checkpoint": None}
            self.put("threads", body, coordinator=p["coordinator"], outcome=p.get("outcome_id"), origin=p.get("origin"))
            return body
        if kind == "bind-provider":
            require(actor["kind"] == "launcher", "forbidden", "Trusted harness identity producer required")
            fields(p, ("expected_revision", "identity"))
            fields(p["identity"], ("provider", "session_id", "resume_ref", "evidence"))
            for value in p["identity"].values():
                nonempty(value)
            body = self.get("sessions", subject)
            self.revision(body, p["expected_revision"])
            require(body["identity"] is None, "conflict", "Provider identity is immutable once bound")
            body["identity"] = p["identity"]
            body["revision"] += 1
            self.update("sessions", body, provider=p["identity"]["provider"], provider_id=p["identity"]["session_id"])
            return body
        if kind in ("outcome-scope", "complete-outcome"):
            return self.outcome_event(event, actor)
        if kind == "observe":
            fields(p, ("expected_revision", "state", "location", "observed_at", "source"))
            require(actor["kind"] in ("observer", "launcher"), "forbidden", "Observation producer required")
            require(p["state"] in ("available", "exited", "unknown"), "invalid", "Bad observation state")
            require(p["location"] is None or isinstance(p["location"], str), "invalid", "Bad location")
            nonempty(p["source"])
            observed = timestamp(p["observed_at"])
            body = self.get("sessions", subject)
            self.revision(body, p["expected_revision"])
            if body["observation"]:
                require(observed > timestamp(body["observation"]["observed_at"]), "stale", "Older observation")
            body["observation"] = {k: v for k, v in p.items() if k != "expected_revision"}
            body["revision"] += 1
            self.update("sessions", body)
            return body
        if kind == "checkpoint":
            fields(p, ("thread", "expected_revision", "assignment_revision", "content"), ("disposition", "human_approval"))
            t = self.get("threads", p["thread"])
            self.owner(t, actor)
            self.revision(t, p["expected_revision"])
            integer(p["assignment_revision"])
            require(t["assignment_revision"] == p["assignment_revision"], "stale", "Assignment has changed")
            if "disposition" in p:
                require(p["disposition"] in ("open", "parked", "closed"), "invalid", "Bad thread disposition")
                nonempty(p.get("human_approval"))
                t["disposition"] = p["disposition"]
            cp = self.checkpoint(subject, t, actor["session"], p["content"], event["time"])
            t["revision"] += 1
            self.update("threads", t, checkpoint=cp["id"])
            return t
        if kind == "revise-engagement":
            fields(p, ("thread", "expected_thread_revision", "expected_assignment_revision",
                       "expected_engagement_revision", "mode", "exit_condition", "reason", "authority"))
            t = self.get("threads", p["thread"])
            self.owner(t, actor)
            self.revision(t, p["expected_thread_revision"])
            integer(p["expected_assignment_revision"])
            integer(p["expected_engagement_revision"], 1)
            require(t["assignment_revision"] == p["expected_assignment_revision"]
                    and t.get("engagement_revision", 0) == p["expected_engagement_revision"],
                    "stale", "Engagement assignment changed")
            interaction(p["mode"], p["exit_condition"])
            nonempty(p["reason"])
            links(p["authority"])
            require(bool(p["authority"]), "invalid", "Explicit revision authority required")
            previous = self.engagement(t["id"])
            require(previous is not None, "invalid", "No accepted engagement to revise")
            require((p["mode"], p["exit_condition"]) != (previous["mode"], previous["exit_condition"]),
                    "invalid", "Engagement agreement is unchanged")
            t["engagement_revision"] += 1
            t["assignment_revision"] += 1
            t["revision"] += 1
            engagement = {"id": subject, "thread": t["id"], "revision": t["engagement_revision"],
                          "assignment_revision": t["assignment_revision"], "mode": p["mode"],
                          "exit_condition": p["exit_condition"], "source_handoff": previous["source_handoff"],
                          "source_handoff_revision": previous["source_handoff_revision"],
                          "authority": p["authority"], "reason": p["reason"], "time": event["time"]}
            self.put("engagements", engagement, thread=t["id"], revision=engagement["revision"])
            self.update("threads", t)
            return engagement
        if kind == "prepare":
            fields(p, ("thread", "expected_thread_revision", "receiver", "brief", "authority", "expected_handoff_revision"))
            t = self.get("threads", p["thread"])
            self.owner(t, actor)
            self.revision(t, p["expected_thread_revision"])
            self.get("sessions", p["receiver"])
            require(p["receiver"] != t["coordinator"], "invalid", "Receiver already coordinates thread")
            fields(p["brief"], ("ref", "outcome", "sources", "decisions", "scope", "exclusions",
                                "next_action", "destination", "mode", "exit_condition"))
            for key in ("ref", "outcome", "scope", "exclusions", "next_action", "destination"):
                nonempty(p["brief"][key])
            interaction(p["brief"]["mode"], p["brief"]["exit_condition"])
            links(p["brief"]["sources"])
            strings(p["brief"]["decisions"])
            nonempty(p["authority"])
            integer(p["expected_handoff_revision"])
            old = self.db.execute("SELECT body FROM handoffs WHERE id=? ORDER BY revision DESC LIMIT 1", (subject,)).fetchone()
            previous = json.loads(old[0]) if old else None
            require(p["expected_handoff_revision"] == (previous["revision"] if previous else 0), "stale", "Handoff revision changed")
            if previous:
                require(previous["thread"] == t["id"] and previous["sender"] == actor["session"]
                        and previous["state"] not in ("accepted", "cancelled"), "conflict", "Cannot revise terminal or unrelated handoff")
            body = {"id": subject, "revision": p["expected_handoff_revision"] + 1,
                    "state_revision": 0, "thread": t["id"], "sender": t["coordinator"],
                    "receiver": p["receiver"], "previous_assignment": t["assignment_revision"],
                    "brief": p["brief"], "brief_hash": digest(p["brief"]), "authority": p["authority"],
                    "state": "prepared", "clarifications": 0, "questions": [], "resolution": None,
                    "acceptance": None}
            self.put("handoffs", body, revision=body["revision"], thread=t["id"], sender=body["sender"], receiver=body["receiver"])
            return body
        if kind in ("send", "clarify", "accept", "cancel"):
            return self.handoff(event, actor)
        if kind == "launch-request":
            require(actor["kind"] == "operator", "forbidden", "Trusted operator route approval required")
            fields(p, ("thread", "handoff", "role", "profile", "mode", "session", "sources", "human_approval"))
            self.get("threads", p["thread"])
            for key in ("role", "profile", "human_approval"):
                nonempty(p[key])
            links(p["sources"])
            require(p["mode"] in ("create", "resume"), "invalid", "Bad launch mode")
            if p["handoff"] is not None:
                fields(p["handoff"], ("id", "revision"))
                h = self.get("handoffs", p["handoff"]["id"])
                require(h["revision"] == p["handoff"]["revision"] and h["thread"] == p["thread"], "stale", "Handoff mismatch")
            if p["mode"] == "resume":
                self.get("sessions", p["session"])
            else:
                require(p["session"] is None, "invalid", "Create cannot name a resume session")
            body = {"id": subject, **p, "revision": 0, "result": "pending", "inert": True}
            self.put("launch_requests", body, thread=p["thread"])
            return body
        if kind == "launch-result":
            require(actor["kind"] == "launcher", "forbidden", "Fixture launcher required")
            fields(p, ("expected_revision", "result", "reason"))
            require(p["result"] in ("refused", "unknown"), "invalid", "C1 cannot fulfill a real launch")
            nonempty(p["reason"])
            body = self.get("launch_requests", subject)
            self.revision(body, p["expected_revision"])
            require(body["result"] == "pending", "conflict", "Request already resolved")
            body.update(result=p["result"], reason=p["reason"], revision=body["revision"] + 1)
            self.update("launch_requests", body)
            return body
        raise Error("invalid", "Unknown event kind")

    @staticmethod
    def revision(body, expected):
        integer(expected)
        require(body["revision"] == expected, "stale", "Record revision changed")

    @staticmethod
    def owner(thread, actor):
        require(actor["kind"] == "session" and actor["session"] == thread["coordinator"],
                "forbidden", "Current coordinating session required")

    def checkpoint(self, cp_id, thread, author, content, time):
        uid(cp_id)
        semantic(content)
        if "engagement_exit" in content:
            require(thread.get("engagement_revision", 0) == content["engagement_exit"]["revision"],
                    "stale", "Engagement exit targets a different agreement")
        for action in content.get("actions", []):
            if action["destination"]["status"] == "verified":
                destination = self.get("sessions", action["destination"]["session"])
                require(destination["identity"] is not None, "invalid", "Destination identity unverified")
        if content.get("conditions"):
            require(bool(thread.get("outcome_id")), "invalid", "Condition updates need an outcome")
            outcome = self.get("outcomes", thread["outcome_id"])
            require(content["scope_revision"] == outcome["scope_revision"], "stale", "Scope changed")
            condition_ids = {c["id"] for c in outcome["conditions"]}
            require(all(c["id"] in condition_ids for c in content["conditions"]), "invalid", "Unknown completion condition")
        require(all(timestamp(o["observed_at"]) <= timestamp(time) for o in content.get("observations", [])),
                "invalid", "Observation cannot postdate authored checkpoint")
        cp = {"id": cp_id, "thread": thread["id"], "author": author,
              "assignment_revision": thread["assignment_revision"], "content": content, "time": time}
        self.put("checkpoints", cp, thread=thread["id"], author=author)
        thread["checkpoint"] = cp_id
        return cp

    def handoff(self, event, actor):
        kind, p = event["kind"], event["payload"]
        extra = {"send": ("resolution",), "clarify": ("questions",), "cancel": ("reason",),
                 "accept": ("expected_thread_revision", "previous_coordinator", "checkpoint_id", "content", "understanding")}
        fields(p, ("revision", "expected_state_revision", *extra[kind]))
        h = self.get("handoffs", event["subject"])
        integer(p["revision"], 1)
        integer(p["expected_state_revision"])
        require(h["revision"] == p["revision"] and h["state_revision"] == p["expected_state_revision"],
                "stale", "Handoff revision changed")
        receiver_action = kind in ("clarify", "accept")
        require(actor["kind"] == "session" and actor["session"] == h["receiver" if receiver_action else "sender"],
                "forbidden", "Wrong handoff participant")
        t = self.get("threads", h["thread"])
        require(t["coordinator"] == h["sender"] and t["assignment_revision"] == h["previous_assignment"],
                "stale", "Previous coordination assignment changed")
        if kind == "send":
            require(h["state"] in ("prepared", "clarification-needed"), "transition", "Cannot send in this state")
            if h["state"] == "clarification-needed":
                fields(p["resolution"], ("answer", "remaining_questions", "direct_discussion", "authority_resolved"))
                nonempty(p["resolution"]["answer"])
                strings(p["resolution"]["remaining_questions"])
                require(type(p["resolution"]["authority_resolved"]) is bool
                        and type(p["resolution"]["direct_discussion"]) is bool, "invalid", "Expected resolution booleans")
                require(not p["resolution"]["remaining_questions"] or p["resolution"]["direct_discussion"],
                        "invalid", "Remaining questions require explicit direct discussion")
            else:
                require(p["resolution"] is None, "invalid", "No clarification to resolve")
            h.update(state="sent", resolution=p["resolution"])
        elif kind == "clarify":
            require(h["state"] == "sent" and h["clarifications"] == 0, "transition", "Only one consolidated clarification round")
            strings(p["questions"])
            require(bool(p["questions"]), "invalid", "Questions cannot be empty")
            h.update(state="clarification-needed", questions=p["questions"], clarifications=1)
        elif kind == "cancel":
            require(h["state"] in ("prepared", "sent", "clarification-needed"), "transition", "Cannot cancel terminal handoff")
            nonempty(p["reason"])
            h.update(state="cancelled", cancellation=p["reason"])
        else:
            require(h["state"] == "sent", "transition", "Only a sent handoff may be accepted")
            require(h["resolution"] is None or h["resolution"]["authority_resolved"], "authority", "Unresolved authority blocks acceptance")
            self.revision(t, p["expected_thread_revision"])
            require(t["coordinator"] == p["previous_coordinator"], "stale", "Previous coordinator mismatch")
            nonempty(p["understanding"])
            interaction(h["brief"]["mode"], h["brief"]["exit_condition"])
            t["coordinator"] = h["receiver"]
            t["assignment_revision"] += 1
            t["engagement_revision"] = t.get("engagement_revision", 0) + 1
            t["revision"] += 1
            cp = self.checkpoint(p["checkpoint_id"], t, h["receiver"], p["content"], event["time"])
            engagement = {"id": event["id"], "thread": t["id"], "revision": t["engagement_revision"],
                          "assignment_revision": t["assignment_revision"],
                          "mode": h["brief"]["mode"], "exit_condition": h["brief"]["exit_condition"],
                          "source_handoff": h["id"], "source_handoff_revision": h["revision"],
                          "authority": [{"type": "handoff", "ref": h["authority"]}],
                          "reason": "Receiver accepted the versioned brief", "time": event["time"]}
            self.put("engagements", engagement, thread=t["id"], revision=engagement["revision"])
            self.update("threads", t, coordinator=t["coordinator"], checkpoint=cp["id"])
            h.update(state="accepted", acceptance={"session": actor["session"], "time": event["time"],
                     "understanding": p["understanding"], "checkpoint": cp["id"],
                     "assignment_revision": t["assignment_revision"]})
        h["state_revision"] += 1
        self.update("handoffs", h)
        return h

    def outcome_event(self, event, actor):
        p, subject = event["payload"], event["subject"]
        require(actor["kind"] == "session", "forbidden", "Bound working session required")
        if event["kind"] == "outcome-scope":
            fields(p, ("expected_revision", "title", "conditions", "authority", "reason"))
            nonempty(p["title"])
            nonempty(p["reason"])
            links(p["authority"])
            require(bool(p["authority"]), "invalid", "Scope authority required")
            require(isinstance(p["conditions"], list) and bool(p["conditions"]), "invalid", "Done conditions required")
            for condition in p["conditions"]:
                fields(condition, ("id", "text"))
                nonempty(condition["id"])
                nonempty(condition["text"])
            ids = [c["id"] for c in p["conditions"]]
            require(len(ids) == len(set(ids)), "invalid", "Duplicate conditions")
            integer(p["expected_revision"])
            row = self.db.execute("SELECT body FROM outcomes WHERE id=?", (subject,)).fetchone()
            old = json.loads(row[0]) if row else None
            if old:
                self.revision(old, p["expected_revision"])
                require(old["owner"] == actor["session"], "forbidden", "Outcome coordinator required")
            else:
                require(p["expected_revision"] == 0, "stale", "New outcome expects revision zero")
                self.get("sessions", actor["session"])
            body = {"id": subject, "owner": actor["session"], "revision": (old["revision"] if old else 0) + 1,
                    "scope_revision": (old["scope_revision"] if old else 0) + 1,
                    "title": p["title"], "conditions": p["conditions"], "authority": p["authority"],
                    "authored_at": event["time"], "reason": p["reason"], "completion": None}
            if old:
                self.update("outcomes", body)
            else:
                self.put("outcomes", body, owner=actor["session"])
            self.put("outcome_scopes", body, revision=body["scope_revision"])
            return body
        fields(p, ("expected_revision", "scope_revision", "acceptance_evidence"))
        body = self.get("outcomes", subject)
        self.revision(body, p["expected_revision"])
        require(body["owner"] == actor["session"], "forbidden", "Outcome coordinator required")
        require(body["scope_revision"] == p["scope_revision"], "stale", "Scope changed")
        require(body["completion"] is None, "conflict", "Outcome already complete")
        links(p["acceptance_evidence"])
        require(bool(p["acceptance_evidence"]), "invalid", "Explicit acceptance evidence required")
        derived = self.derive_outcome(body, event["time"], 7 * 86400)
        require(all(c["state"] == "met" for c in derived["conditions"]), "incomplete", "Completion conditions lack current supporting evidence")
        require(not any(a["category"] in ("required-now", "waiting") for a in derived["actions"]),
                "incomplete", "Required actions remain; checkpoint the final position first")
        body["revision"] += 1
        body["completion"] = {"authored_at": event["time"], "scope_revision": body["scope_revision"],
                              "acceptance_evidence": p["acceptance_evidence"], "conditions": derived["conditions"]}
        self.update("outcomes", body)
        return body

    def derive_outcome(self, outcome, as_of, stale_seconds):
        at = timestamp(as_of)
        threads = [json.loads(r[0]) for r in self.db.execute("SELECT body FROM threads WHERE outcome=? ORDER BY id", (outcome["id"],))]
        cps = [json.loads(r[0]) for r in self.db.execute(
            "SELECT c.body FROM checkpoints c JOIN threads t ON c.thread=t.id WHERE t.outcome=? ORDER BY c.rowid", (outcome["id"],))]
        evidence, updates = {}, {}
        for cp in cps:
            for observation in cp["content"].get("observations", []):
                old = evidence.get(observation["key"])
                if old is None or timestamp(observation["observed_at"]) > timestamp(old["observed_at"]):
                    evidence[observation["key"]] = {**observation, "checkpoint": cp["id"], "authored_at": cp["time"]}
                elif timestamp(observation["observed_at"]) == timestamp(old["observed_at"]) and any(old.get(k) != v for k, v in observation.items()):
                    old["status"] = "unknown"
                    old["ambiguity"] = "Conflicting observations at the same time"
            if cp["content"].get("scope_revision") == outcome["scope_revision"]:
                for condition in cp["content"].get("conditions", []):
                    updates[condition["id"]] = {**condition, "checkpoint": cp["id"], "authored_at": cp["time"]}
        for item in evidence.values():
            age = (at - timestamp(item["observed_at"])).total_seconds()
            item["stale"] = age > stale_seconds or age < 0
        conditions = []
        for condition in outcome["conditions"]:
            update = updates.get(condition["id"])
            state = update["state"] if update else "unknown"
            if update and state == "met" and not all(key in evidence and evidence[key]["status"] == "supported"
                    and not evidence[key]["stale"] for key in update["evidence"]):
                state = "unknown"
            conditions.append({**condition, "state": state, "interpretation": update,
                               "remaining": update["remaining"] if update else "Evidence missing; completion unknown"})
        actions, details = [], []
        for t in threads:
            session = self.get("sessions", t["coordinator"])
            cp = self.get("checkpoints", t["checkpoint"]) if t["checkpoint"] else None
            details.append({"thread": t, "session": session})
            if not cp:
                continue
            proposed = cp["content"].get("actions")
            if proposed is None:
                proposed = [{"id": "legacy", "text": cp["content"]["next_action"], "category": "required-now",
                             "actor": {"status": "unknown", "name": None, "evidence": []},
                             "destination": {"status": "unknown", "session": None}, "dependencies": [],
                             "evidence": [], "contribution": "Legacy single action; assignment unverified"}]
            for action in proposed:
                waiting, uncertain = [], []
                for key in action["dependencies"]:
                    fact = evidence.get(key)
                    if not fact or fact["stale"] or fact["status"] != "supported" or "blocks" not in fact:
                        uncertain.append(key)
                    elif fact["blocks"]:
                        waiting.append(key)
                destination = action["destination"]
                located = False
                if destination["status"] == "verified":
                    dest = self.get("sessions", destination["session"])
                    obs = dest["observation"]
                    located = bool(obs and obs["state"] == "available" and obs["location"]
                                   and 0 <= (at - timestamp(obs["observed_at"])).total_seconds() <= stale_seconds)
                actions.append({**action, "thread": t["id"], "checkpoint": cp["id"],
                                "waiting_for": waiting, "dependency_unknown": uncertain,
                                "destination_note": "last observed location available" if located else "session not located; discover existing session",
                                "recommendation_only": True})
        return {"outcome": outcome, "conditions": conditions, "threads": details,
                "evidence": evidence, "actions": actions, "completed": outcome["completion"] is not None,
                "ready_to_close": outcome["completion"] is not None,
                "remaining_acceptance": None if outcome["completion"] else "Explicit outcome acceptance required",
                "scope_history": [json.loads(r[0]) for r in self.db.execute("SELECT body FROM outcome_scopes WHERE id=? ORDER BY revision", (outcome["id"],))],
                "advisory_owner": "Danny", "record_owner": "Concierge", "execution_authority": "none"}

    def outcome_view(self, outcome_id=None, as_of=None, stale_seconds=604800):
        integer(stale_seconds)
        self.db.execute("BEGIN")
        try:
            rows = self.db.execute("SELECT body FROM outcomes" + (" WHERE id=?" if outcome_id else "") + " ORDER BY id LIMIT 200",
                                   (outcome_id,) if outcome_id else ()).fetchall()
            result = [self.derive_outcome(json.loads(r[0]), as_of or now(), stale_seconds) for r in rows]
            self.db.execute("COMMIT")
            return result
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def query(self, thread=None, link=None, limit=50):
        integer(limit, 1)
        require(limit <= 200, "invalid", "Query limit is 200")
        if link is not None:
            links([link])
        # One read transaction prevents a view spanning two acceptance commits.
        self.db.execute("BEGIN")
        try:
            args = []
            conditions = []
            if thread:
                conditions.append("id=?")
                args.append(thread)
            if link:
                conditions.append("EXISTS (SELECT 1 FROM json_each(threads.body, '$.links') AS l "
                                  "WHERE json_extract(l.value, '$.type')=? AND json_extract(l.value, '$.ref')=?)")
                args.extend((link["type"], link["ref"]))
            sql = "SELECT body FROM threads" + (" WHERE " + " AND ".join(conditions) if conditions else "")
            rows = self.db.execute(sql + " ORDER BY id LIMIT ?", (*args, limit)).fetchall()
            output = []
            for row in rows:
                t = json.loads(row[0])
                session = self.get("sessions", t["coordinator"])
                cp = self.get("checkpoints", t["checkpoint"]) if t["checkpoint"] else None
                hs = [json.loads(r[0]) for r in self.db.execute(
                    "SELECT body FROM handoffs h WHERE thread=? AND revision=(SELECT max(revision) FROM handoffs WHERE id=h.id) ORDER BY id", (t["id"],))]
                engagement_history = [json.loads(r[0]) for r in self.db.execute(
                    "SELECT body FROM engagements WHERE thread=? ORDER BY revision", (t["id"],))]
                engagement = engagement_history[-1] if engagement_history else None
                engagement_exit = None
                if engagement:
                    for item in self.db.execute("SELECT body FROM checkpoints WHERE thread=? ORDER BY rowid DESC", (t["id"],)):
                        candidate = json.loads(item[0])
                        result = candidate["content"].get("engagement_exit")
                        if result and result["revision"] == engagement["revision"]:
                            engagement_exit = {**result, "checkpoint": candidate["id"], "authored_at": candidate["time"]}
                            break
                accepted = any(h["state"] == "accepted" and h["receiver"] == t["coordinator"]
                               and h["acceptance"]["assignment_revision"] <= t["assignment_revision"] for h in hs)
                issues = []
                if session["identity"] is None:
                    issues.append("provider identity/resume reference unknown")
                if session["observation"] is None:
                    issues.append("availability/location unknown")
                elif session["observation"]["state"] != "available":
                    issues.append("destination observed " + session["observation"]["state"] + "; execution ownership unknown")
                if cp is None:
                    issues.append("semantic checkpoint missing")
                if t["disposition"] == "closed" and engagement is None:
                    issues.append("engagement agreement missing; closure does not prove exit")
                elif t["disposition"] == "closed" and engagement_exit is None:
                    issues.append("engagement exit evidence missing; closure does not prove exit")
                elif t["disposition"] == "closed" and engagement_exit["assessment"] != "met":
                    issues.append("engagement exit not met; closure does not prove exit")
                output.append({"thread": t, "destination": session, "checkpoint": cp, "handoffs": hs,
                               "engagement": engagement, "engagement_history": engagement_history,
                               "engagement_exit": engagement_exit,
                               "issues": issues, "suggest_intake_closure": bool(accepted and cp and session["identity"]),
                               "runtime_authority": "unchanged"})
            self.db.execute("COMMIT")
            return output
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def backup(self, target, _snapshot_time=None, _track=True):
        from continuity_feedback import Feedback
        snapshot_time = datetime.now(timezone.utc).timestamp() if _snapshot_time is None else _snapshot_time
        if _track:
            Feedback(self, clock=lambda: snapshot_time).maintain()
        target = private_path(target, creating=True)
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            raise Error("exists", "Backup target already exists") from None
        os.close(fd)
        if _track:
            # Record before copying; a failed copy is still eligible for cleanup.
            self.db.execute("INSERT INTO feedback_backups VALUES(?,?)", (str(target), snapshot_time))
        temporary_fd, temporary_path = tempfile.mkstemp(prefix=".continuity-snapshot-", dir=target.parent)
        os.close(temporary_fd)
        destination = sqlite3.connect(temporary_path)
        try:
            self.db.backup(destination)
            destination.execute("INSERT OR REPLACE INTO store_meta VALUES('snapshot_time',?)",
                                (str(snapshot_time),))
            # Snapshot must not inherit maintenance ownership of the source's backups.
            destination.execute("DELETE FROM feedback_backups")
            destination.commit()
            destination.close()
            os.replace(temporary_path, target)
        finally:
            destination.close()
            Path(temporary_path).unlink(missing_ok=True)


def render(rows):
    lines = []
    for row in rows:
        t, s, cp = row["thread"], row["destination"], row["checkpoint"]
        engagement, engagement_exit = row["engagement"], row["engagement_exit"]
        lines.extend((f"{t['title']} [{t['disposition']}] {t['id']}", f"  Outcome: {t['outcome']}",
                      f"  Destination: {s['role']} / {s['environment']} / {s['id']}",
                      f"  Intended mode: {engagement['mode'] if engagement else 'unknown'}",
                      f"  Exit condition: {engagement['exit_condition'] if engagement else 'unknown'}",
                      f"  Engagement revision: {engagement['revision'] if engagement else 'unknown'}",
                      f"  Actual exit: {engagement_exit['assessment'] if engagement_exit else 'unknown — no exit evidence'}",
                      f"  Resume reference: {s['identity']['resume_ref'] if s['identity'] else 'unknown'}",
                      f"  Last observation: {canonical(s['observation'])}",
                      f"  Next: {cp['content'].get('next_action', '; '.join(a['text'] for a in cp['content'].get('actions', [])) or 'No required next action') if cp else 'unknown — checkpoint missing'}"))
        if engagement_exit:
            lines.append("  Exit evidence: " + canonical(engagement_exit["evidence"]))
            if engagement_exit["remaining"]:
                lines.append("  Exit gap: " + engagement_exit["remaining"])
            if engagement_exit["next_action"]:
                lines.append("  Exit next action: " + engagement_exit["next_action"])
        lines.extend("  Attention: " + issue for issue in row["issues"])
        if row["suggest_intake_closure"]:
            lines.append("  Accepted handoff and durable checkpoint: suggest manual intake closure.")
        lines.append("  Observation/resume context grants no execution or runtime authority.")
    return "\n".join(lines) or "No matching threads."


def render_outcomes(rows):
    lines = []
    for row in rows:
        o = row["outcome"]
        lines.append(f"{o['title']} — {'complete; ready to close' if row['completed'] else 'open'} (scope {o['scope_revision']})")
        lines.append("  Scope authority: " + canonical(o["authority"]))
        for old in row["scope_history"][:-1]:
            lines.append(f"  Previous scope {old['scope_revision']} (historical): " + "; ".join(c['text'] for c in old['conditions']))
        lines.append("  Current scope rationale: " + o["reason"])
        for condition in row["conditions"]:
            lines.append(f"  Done when [{condition['state']}]: {condition['text']} — {condition['remaining']}")
        for detail in row["threads"]:
            lines.append(f"  Thread {detail['thread']['id']}: {detail['thread']['title']} → session {detail['session']['id']}")
        for action in row["actions"]:
            lines.append(f"  {action['category']}: {action['text']} — actor {action['actor']['name'] or 'unknown'} ({action['actor']['status']}); {action['destination_note']}")
            lines.append(f"    Advances: {action['contribution']}; waiting: {action['waiting_for']}; unknown dependencies: {action['dependency_unknown']}")
        for fact in row["evidence"].values():
            lines.append(f"  Evidence {fact['key']} [{fact['status']}{'; stale' if fact['stale'] else ''}] observed {fact['observed_at']}: {fact['claim']} ({fact['source']['ref']})")
            if fact.get("hold_reason"):
                lines.append(f"    Held: {fact['hold_reason']}; release when: {fact['release_condition']}")
        if row["remaining_acceptance"]:
            lines.append("  " + row["remaining_acceptance"])
        lines.append("  Danny advisory view / Concierge records. Recommendations grant no execution authority.")
    return "\n".join(lines) or "No matching outcomes."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Explicit store path; never defaults to live state")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Explicitly initialize an empty store in a private directory")
    apply = sub.add_parser("apply", help="Read one event JSON from stdin (trusted operator only)")
    apply.add_argument("--producer", required=True)
    apply.add_argument("--kind", required=True, choices=("operator", "launcher", "observer", "session"))
    apply.add_argument("--session")
    for name in ("query", "view"):
        query = sub.add_parser(name)
        query.add_argument("--thread")
        query.add_argument("--link-type")
        query.add_argument("--link-ref")
        query.add_argument("--limit", type=int, default=50)
    backup = sub.add_parser("backup")
    backup.add_argument("target")
    outcome = sub.add_parser("outcomes", help="Derived Danny advisory view; no external reads")
    outcome.add_argument("--outcome")
    outcome.add_argument("--as-of")
    outcome.add_argument("--json", action="store_true")
    args = parser.parse_args()
    store = None
    try:
        if args.command == "init":
            Store.initialize(args.db)
            result = {"ok": True, "schema_version": VERSION}
        else:
            store = Store(args.db, readonly=args.command not in ("apply", "backup"))
            if args.command == "apply":
                data = sys.stdin.buffer.read(MAX_BYTES + 1)
                require(len(data) <= MAX_BYTES, "invalid", "Event exceeds 64 KiB")
                result = store.apply(json.loads(data), {"producer": args.producer, "kind": args.kind, "session": args.session})
            elif args.command == "backup":
                store.backup(args.target)
                result = {"ok": True}
            elif args.command == "outcomes":
                result = store.outcome_view(args.outcome, args.as_of)
                if not args.json:
                    print(render_outcomes(result))
                    return 0
            else:
                require(bool(args.link_type) == bool(args.link_ref), "invalid", "Both link fields required")
                link = {"type": args.link_type, "ref": args.link_ref} if args.link_type else None
                result = store.query(args.thread, link, args.limit)
                if args.command == "view":
                    print(render(result))
                    return 0
        print(canonical(result))
        return 2 if isinstance(result, dict) and result.get("ok") is False else 0
    except (Error, sqlite3.Error, OSError, ValueError, TypeError) as exc:
        code = getattr(exc, "code", "storage" if isinstance(exc, (sqlite3.Error, OSError)) else "invalid")
        print(canonical({"ok": False, "error": {"code": code, "message": str(exc)}}))
        return 2
    finally:
        if store:
            store.close()


if __name__ == "__main__":
    sys.exit(main())

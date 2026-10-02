"""Offline feedback protocol in the continuity DB. No live collection or prompts.

Only the trusted owner/collector calls this API. `bound_session` and `producer`
are transport metadata, NOT fields supplied by the contributing session.
Fixture simulation is opt-in per instance; production prompting has no enable API.
"""

import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from uuid import UUID


DEFAULTS = {"status": "proposed-disabled", "cooldown_seconds": 86400,
            "unconfirmed_seconds": 600, "feedback_seconds": 90 * 86400,
            "quote_chars": 512, "context_bytes": 2048,
            "acknowledged_outbox_seconds": 86400, "pending_outbox_seconds": 7 * 86400,
            "diagnostic_seconds": 30 * 86400, "backup_seconds": 7 * 86400}
SCHEMA = """
CREATE TABLE feedback_control (
 id INTEGER PRIMARY KEY CHECK(id=1), last_claim REAL, last_clock REAL,
 omit_all INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL
);
CREATE TABLE feedback_prompts (
 id TEXT PRIMARY KEY, outcome TEXT NOT NULL UNIQUE REFERENCES outcomes(id),
 thread TEXT NOT NULL REFERENCES threads(id), checkpoint TEXT NOT NULL REFERENCES checkpoints(id),
 session TEXT NOT NULL REFERENCES sessions(id), claimed REAL NOT NULL, state TEXT NOT NULL,
 shown REAL, terminal REAL
);
CREATE TABLE feedback_content (
 id TEXT PRIMARY KEY, outcome TEXT NOT NULL REFERENCES outcomes(id), request TEXT,
 thread TEXT NOT NULL REFERENCES threads(id), session TEXT NOT NULL REFERENCES sessions(id),
 received REAL NOT NULL, body TEXT NOT NULL
);
CREATE TABLE feedback_receipts (
 id TEXT PRIMARY KEY, producer TEXT NOT NULL, sequence INTEGER NOT NULL,
 outcome TEXT, request TEXT, content TEXT, payload_hash TEXT, result TEXT NOT NULL,
 received REAL NOT NULL, UNIQUE(producer,sequence)
);
CREATE TABLE feedback_suppression (outcome TEXT PRIMARY KEY);
CREATE TABLE feedback_deleted (id TEXT PRIMARY KEY);
CREATE TABLE feedback_diagnostics (id TEXT PRIMARY KEY, received REAL NOT NULL, code TEXT NOT NULL);
CREATE TABLE feedback_backups (path TEXT PRIMARY KEY, created REAL NOT NULL);
CREATE TABLE store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO feedback_control(id,settings) VALUES(1, '%s');
""" % json.dumps(DEFAULTS, sort_keys=True, separators=(",", ":"))


class FeedbackError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def check(condition, code, message):
    if not condition:
        raise FeedbackError(code, message)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def shape(value, keys):
    check(isinstance(value, dict) and set(value) == set(keys), "invalid", "Unexpected feedback fields")


def uuid(value):
    try:
        check(isinstance(value, str) and str(UUID(value)) == value, "invalid", "Expected UUID")
    except (ValueError, TypeError, AttributeError):
        raise FeedbackError("invalid", "Expected UUID") from None


def text(value):
    check(isinstance(value, str) and bool(value.strip()), "invalid", "Expected nonempty text")


class Feedback:
    def __init__(self, store, *, clock=time.time, simulate=False):
        self.store, self.db, self.clock, self.simulate = store, store.db, clock, simulate
        self.settings = json.loads(self.db.execute("SELECT settings FROM feedback_control WHERE id=1").fetchone()[0])

    def _record(self, family, identity):
        try:
            return self.store.get(family, identity)
        except Exception as exc:
            if hasattr(exc, "code"):
                raise FeedbackError(exc.code, "Context record unavailable") from None
            raise

    def _time(self):
        current = self.clock()
        check(type(current) in (int, float) and 0 <= current < 1e12, "clock", "Trusted time unavailable")
        control = self.db.execute("SELECT * FROM feedback_control WHERE id=1").fetchone()
        check(control["last_clock"] is None or current >= control["last_clock"], "clock", "Clock rollback: omit prompt")
        self.db.execute("UPDATE feedback_control SET last_clock=? WHERE id=1", (current,))
        return current

    def _context(self, outcome, thread, checkpoint, session):
        for value in (outcome, thread, checkpoint, session):
            uuid(value)
        self._record("outcomes", outcome)
        t = self._record("threads", thread)
        cp = self._record("checkpoints", checkpoint)
        check(t.get("outcome_id") == outcome and cp["thread"] == thread,
              "binding", "Context does not belong to this outcome/thread")
        check(t["coordinator"] == session, "binding", "Contributor is not bound to this thread assignment")
        return t

    def submit(self, envelope, *, bound_session, producer):
        """Return saved only after commit. No raw payload enters general events.

        Erased receipts deliberately cannot compare content: a matching ID/sequence
        becomes a suppressed no-op, never resurrection. Active mismatched replay is
        rejected. Diagnostic rows contain only fixed error codes, never exception text.
        """
        try:
            shape(envelope, ("id", "sequence", "kind", "payload"))
            uuid(envelope["id"])
            uuid(bound_session)
            text(producer)
            check(type(envelope["sequence"]) is int and envelope["sequence"] >= 0, "invalid", "Bad sequence")
            check(isinstance(envelope["payload"], dict), "invalid", "Expected payload object")
            check(len(encoded(envelope).encode()) <= 8192, "invalid", "Oversized feedback event")
            self._record("sessions", bound_session)
            fingerprint = hashlib.sha256(encoded([envelope, bound_session, producer]).encode()).hexdigest()
            self.db.execute("BEGIN IMMEDIATE")
            try:
                prior = self.db.execute("SELECT * FROM feedback_receipts WHERE id=? OR (producer=? AND sequence=?)",
                                        (envelope["id"], producer, envelope["sequence"])).fetchall()
                if prior:
                    check(len(prior) == 1 and prior[0]["id"] == envelope["id"] and prior[0]["producer"] == producer,
                          "replay_conflict", "Feedback identity collision")
                    if prior[0]["payload_hash"] is None:
                        result = {"ok": True, "saved": False, "state": "suppressed"}
                    else:
                        check(prior[0]["payload_hash"] == fingerprint, "replay_conflict", "Mismatched feedback replay")
                        result = json.loads(prior[0]["result"])
                        if envelope["kind"] == "claim":
                            result["display_permitted"] = False
                    self.db.execute("COMMIT")
                    return result
                if self.db.execute("SELECT 1 FROM feedback_deleted WHERE id=?", (envelope["id"],)).fetchone():
                    self.db.execute("COMMIT")
                    return {"ok": True, "saved": False, "state": "suppressed"}
                current = self._time()
                # No payload is persisted on rejection, including secret-like input.
                result, outcome, request, content = self._dispatch(envelope, bound_session, current)
                self.db.execute("INSERT INTO feedback_receipts VALUES(?,?,?,?,?,?,?,?,?)",
                                (envelope["id"], producer, envelope["sequence"], outcome, request, content,
                                 fingerprint, encoded(result), current))
                self.db.execute("INSERT INTO feedback_diagnostics VALUES(?,?,?)", (envelope["id"], current, result["state"]))
                self.db.execute("COMMIT")
                return result
            except BaseException:
                if self.db.in_transaction:
                    self.db.execute("ROLLBACK")
                raise
        except (FeedbackError, sqlite3.Error, ValueError, TypeError) as exc:
            return {"ok": False, "saved": False, "state": "not_saved",
                    "error": getattr(exc, "code", "write_failed" if isinstance(exc, sqlite3.Error) else "invalid")}

    def _dispatch(self, envelope, session, current):
        kind, p, event_id = envelope["kind"], envelope["payload"], envelope["id"]
        if kind == "claim":
            shape(p, ("request", "outcome", "thread", "checkpoint", "natural_pause", "other_question_pending"))
            uuid(p["request"])
            check(type(p["natural_pause"]) is bool and type(p["other_question_pending"]) is bool,
                  "invalid", "Pause and question state must be known")
            self._context(p["outcome"], p["thread"], p["checkpoint"], session)
            control = self.db.execute("SELECT * FROM feedback_control WHERE id=1").fetchone()
            suppressed = self.db.execute("SELECT 1 FROM feedback_suppression WHERE outcome=?", (p["outcome"],)).fetchone()
            permitted = (self.simulate and not control["omit_all"] and p["natural_pause"]
                         and not p["other_question_pending"] and not suppressed
                         and (control["last_claim"] is None or current - control["last_claim"] >= self.settings["cooldown_seconds"]))
            if not permitted:
                return {"ok": True, "saved": False, "state": "omit"}, p["outcome"], None, None
            self.db.execute("INSERT INTO feedback_prompts VALUES(?,?,?,?,?,?,'claimed',NULL,NULL)",
                            (p["request"], p["outcome"], p["thread"], p["checkpoint"], session, current))
            self.db.execute("INSERT INTO feedback_suppression VALUES(?)", (p["outcome"],))
            self.db.execute("UPDATE feedback_control SET last_claim=? WHERE id=1", (current,))
            return {"ok": True, "saved": True, "state": "claimed", "request": p["request"], "display_permitted": True}, p["outcome"], p["request"], None
        if kind in ("shown", "skip", "silence"):
            shape(p, ("request", "outcome"))
            prompt = self._prompt(p, session, current)
            check(prompt["session"] == session, "binding", "Display state must come from original session")
            if kind == "shown":
                check(prompt["state"] == "claimed" and current - prompt["claimed"] < self.settings["unconfirmed_seconds"],
                      "transition", "Claim unconfirmed/expired; do not display or retry")
                self.db.execute("UPDATE feedback_prompts SET state='shown',shown=? WHERE id=?", (current, p["request"]))
                state = "shown"
            else:
                check(prompt["state"] == "shown", "transition", "Only shown prompts can be skipped/unanswered")
                state = "skipped" if kind == "skip" else "unanswered"
                self.db.execute("UPDATE feedback_prompts SET state=?,terminal=? WHERE id=?", (state, current, p["request"]))
            return {"ok": True, "saved": True, "state": state}, p["outcome"], p["request"], None
        if kind in ("answer", "spontaneous"):
            common = ("outcome", "rating", "quote", "context", "interpretation", "capability", "evidence")
            shape(p, (*common, "request") if kind == "answer" else (*common, "thread", "checkpoint"))
            self._content(p)
            if kind == "answer":
                prompt = self._prompt(p, session, current)
                check(prompt["state"] in ("shown", "unanswered", "unknown"), "transition", "Request is not answerable")
                check(p["rating"] in ("Yes", "Mixed", "No"), "invalid", "Prompted rating must be explicit")
                thread, checkpoint, request = prompt["thread"], prompt["checkpoint"], prompt["id"]
                self.db.execute("UPDATE feedback_prompts SET state='answered',terminal=? WHERE id=?", (current, request))
            else:
                self._context(p["outcome"], p["thread"], p["checkpoint"], session)
                check(not self.db.execute("SELECT omit_all FROM feedback_control WHERE id=1").fetchone()[0],
                      "suppressed", "Identity purge requires new human decision")
                text(p["quote"])
                thread, checkpoint, request = p["thread"], p["checkpoint"], None
                self.db.execute("UPDATE feedback_prompts SET state='unknown',terminal=? WHERE outcome=? AND state='claimed'",
                                (current, p["outcome"]))
            self.db.execute("INSERT OR IGNORE INTO feedback_suppression VALUES(?)", (p["outcome"],))
            body = {k: p[k] for k in common}
            body.update(source=kind, checkpoint=checkpoint, session=session, thread=thread,
                        received=current, interpretation_label="agent interpretation")
            self.db.execute("INSERT INTO feedback_content VALUES(?,?,?,?,?,?,?)",
                            (event_id, p["outcome"], request, thread, session, current, encoded(body)))
            return {"ok": True, "saved": True, "state": "answered" if request else "spontaneous", "feedback": event_id}, p["outcome"], request, event_id
        raise FeedbackError("invalid", "Unsupported feedback operation")

    def _prompt(self, payload, session, current):
        uuid(payload["request"])
        uuid(payload["outcome"])
        prompt = self.db.execute("SELECT * FROM feedback_prompts WHERE id=?", (payload["request"],)).fetchone()
        check(prompt is not None and prompt["outcome"] == payload["outcome"], "binding", "Original request/outcome missing or ambiguous")
        check(current - prompt["claimed"] < self.settings["feedback_seconds"], "expired", "Original relationship expired; do not rebind")
        self._context(prompt["outcome"], prompt["thread"], prompt["checkpoint"], session)
        return prompt

    def _content(self, payload):
        check(payload["rating"] is None or payload["rating"] in ("Yes", "Mixed", "No"), "invalid", "No inferred ratings")
        quote = payload["quote"]
        check(quote is None or (isinstance(quote, str) and len(quote) <= self.settings["quote_chars"]), "invalid", "Quote exceeds proposed limit")
        check(isinstance(payload["context"], str) and len(payload["context"].encode()) <= self.settings["context_bytes"], "invalid", "Context exceeds proposed limit")
        check(payload["interpretation"] is None or (isinstance(payload["interpretation"], str) and len(payload["interpretation"].encode()) <= self.settings["context_bytes"]), "invalid", "Invalid interpretation")
        check(payload["capability"] is None or (isinstance(payload["capability"], str) and len(payload["capability"]) <= 128), "invalid", "Unknown capability should be null")
        check(isinstance(payload["evidence"], list) and len(payload["evidence"]) <= 10, "invalid", "Bounded evidence links required")
        for link in payload["evidence"]:
            shape(link, ("type", "ref"))
            text(link["type"])
            text(link["ref"])
        # Defense-in-depth for fixtures, NOT a general secret detector. C2 trusted
        # collector must apply an approved redaction policy before granting access.
        raw = encoded(payload)
        check(not re.search(r"(?i)(-----BEGIN .*PRIVATE KEY|\b(?:password|token|api[_-]?key|secret)\s*[:=]|\b(?:sk-|ghp_)[A-Za-z0-9]{12,}|Bearer\s+\S+)", raw),
              "sensitive_content", "Secret-like feedback rejected")

    def maintain(self):
        """Trusted offline maintenance; never a scheduler or per-tool hook."""
        self.db.execute("BEGIN IMMEDIATE")
        try:
            current = self._time()
            self.db.execute("UPDATE feedback_prompts SET state='unknown',terminal=? WHERE state='claimed' AND claimed<=?",
                            (current, current - self.settings["unconfirmed_seconds"]))
            expired = [r[0] for r in self.db.execute("SELECT id FROM feedback_content WHERE received<=?", (current - self.settings["feedback_seconds"],))]
            self._erase(expired)
            self.db.execute("DELETE FROM feedback_prompts WHERE claimed<=?", (current - self.settings["feedback_seconds"],))
            self.db.execute("DELETE FROM feedback_diagnostics WHERE received<=?", (current - self.settings["diagnostic_seconds"],))
            # Receipt IDs are needed to prevent replay, but content hashes and old
            # saved/answered results must not outlive their short diagnostic window.
            self.db.execute("UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE received<=?",
                            (encoded({"ok": True, "saved": False, "state": "suppressed"}), current - self.settings["diagnostic_seconds"]))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        removed = self._purge_backups(current, all_backups=False)
        return {"expired_content": len(expired), "removed_backups": removed}

    def _erase(self, ids):
        for feedback_id in ids:
            uuid(feedback_id)
            self.db.execute("INSERT OR IGNORE INTO feedback_deleted VALUES(?)", (feedback_id,))
            row = self.db.execute("SELECT outcome,request FROM feedback_content WHERE id=?", (feedback_id,)).fetchone()
            if row:
                self.db.execute("INSERT OR IGNORE INTO feedback_suppression VALUES(?)", (row["outcome"],))
                self.db.execute("DELETE FROM feedback_prompts WHERE id=?", (row["request"],))
                self.db.execute("UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE content=? OR request=?",
                                (encoded({"ok": True, "saved": False, "state": "suppressed"}), feedback_id, row["request"]))
            self.db.execute("DELETE FROM feedback_content WHERE id=?", (feedback_id,))
            self.db.execute("DELETE FROM feedback_diagnostics WHERE id=?", (feedback_id,))

    def delete(self, ids, *, actor, purge_backups=False, full_identity_purge=False, outboxes=()):
        check(actor == "owner", "forbidden", "Only owner-authorised deletion")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            current = self._time()
            if full_identity_purge:
                ids = [r[0] for r in self.db.execute("SELECT id FROM feedback_content")]
                self.db.execute("UPDATE feedback_control SET omit_all=1 WHERE id=1")
            self._erase(ids)
            if full_identity_purge:
                self.db.execute("DELETE FROM feedback_prompts")
                self.db.execute("DELETE FROM feedback_suppression")
                self.db.execute("DELETE FROM feedback_diagnostics")
                self.db.execute("DELETE FROM feedback_receipts")
                self.db.execute("DELETE FROM feedback_deleted")
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        purged = self._purge_backups(current, all_backups=purge_backups)
        for outbox in outboxes:
            if full_identity_purge:
                outbox.rows.clear()
            else:
                outbox.delete(ids)
        return {"deleted": len(ids), "purged_backups": purged,
                "residual_backup_seconds": 0 if purge_backups else self.settings["backup_seconds"],
                "physical_erasure": "not claimed"}

    def _purge_backups(self, current, all_backups):
        removed = []
        rows = self.db.execute("SELECT * FROM feedback_backups").fetchall()
        for row in rows:
            if all_backups or current - row["created"] >= self.settings["backup_seconds"]:
                path = Path(row["path"])
                # Paths come only from trusted backup creation, never an outbox.
                check(not path.is_symlink(), "unsafe_path", "Refuse changed backup symlink")
                path.unlink(missing_ok=True)
                self.db.execute("DELETE FROM feedback_backups WHERE path=?", (str(path),))
                removed.append(str(path))
        return removed

    def backup(self, target):
        current = self.clock()
        self.store.backup(target, _snapshot_time=current)

    def restore(self, source, target):
        """Owner-only restore with CURRENT deletion ledger, before exposure.

        Never restore using an old backup's deletion ledger. If current ledger is
        lost, there is insufficient evidence to restore feedback: refuse here.
        The current live store is not replaced by this offline API.
        """
        from continuity import Store, private_path
        source = private_path(source)
        current = self.clock()
        original = Store(source, readonly=True, _allow_snapshot=True)
        try:
            lineage = "SELECT value FROM store_meta WHERE key='store_id'"
            check(original.db.execute(lineage).fetchone()[0] == self.db.execute(lineage).fetchone()[0],
                  "lineage", "Current deletion ledger is missing or belongs to another store")
            meta = original.db.execute("SELECT value FROM store_meta WHERE key='snapshot_time'").fetchone()
            check(meta is not None and 0 <= current - float(meta[0]) < self.settings["backup_seconds"],
                  "expired", "Backup outside proposed retention window")
            original.backup(target, _snapshot_time=current, _track=False)
        finally:
            original.close()
        restored = Store(target, _allow_snapshot=True)
        try:
            restored.db.execute("BEGIN IMMEDIATE")
            # Retain all post-snapshot suppression/receipt identities as no-content
            # markers. Never resurrect a post-snapshot claim or replay old payloads.
            control = self.db.execute("SELECT * FROM feedback_control WHERE id=1").fetchone()
            check(control["last_clock"] is None or current >= control["last_clock"], "clock", "Clock rollback blocks restore")
            restored.db.execute("UPDATE feedback_control SET last_claim=?,last_clock=?,omit_all=? WHERE id=1",
                                (control["last_claim"], max(current, control["last_clock"] or current), control["omit_all"]))
            deleted = [r[0] for r in self.db.execute("SELECT id FROM feedback_deleted")]
            service = Feedback(restored, clock=self.clock, simulate=self.simulate)
            service._erase(deleted)
            for row in self.db.execute("SELECT * FROM feedback_suppression"):
                restored.db.execute("INSERT OR IGNORE INTO feedback_suppression VALUES(?)", (row[0],))
            for row in self.db.execute("SELECT * FROM feedback_receipts"):
                if row["payload_hash"] is None:
                    restored.db.execute("UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE id=?", (row["result"], row["id"]))
                # Events newer than the snapshot retain only replay suppression.
                # Their feedback was not restored, so never repeat a 'saved' ACK.
                marker = list(row)
                marker[6] = None
                marker[7] = encoded({"ok": True, "saved": False, "state": "suppressed"})
                restored.db.execute("INSERT OR IGNORE INTO feedback_receipts VALUES(?,?,?,?,?,?,?,?,?)", marker)
            # Recovery itself creates uncertainty about an undisplayed request.
            # A snapshot is never a fresh permission to display a claim.
            restored.db.execute("UPDATE feedback_prompts SET state='unknown',terminal=? WHERE state='claimed'", (current,))
            for prompt in self.db.execute("SELECT id,state,terminal FROM feedback_prompts WHERE state='skipped'"):
                restored.db.execute("UPDATE feedback_prompts SET state=?,terminal=? WHERE id=?", (prompt["state"], prompt["terminal"], prompt["id"]))
            if control["omit_all"]:
                for table in ("feedback_content", "feedback_prompts", "feedback_receipts", "feedback_suppression", "feedback_deleted", "feedback_diagnostics"):
                    restored.db.execute(f"DELETE FROM {table}")
            restored.db.execute("COMMIT")
            service.maintain()
            # A crash before this point leaves a sealed snapshot; Store refuses it.
            restored.db.execute("DELETE FROM store_meta WHERE key='snapshot_time'")
        finally:
            restored.close()

    def review(self, *, reviewer, start, end, authorization=None, limit=100):
        check(reviewer in ("owner", "collector", "concierge"), "forbidden", "Raw feedback unavailable to this role")
        check(type(start) in (int, float) and type(end) in (int, float) and 0 <= end - start <= 90 * 86400,
              "invalid", "Bounded review window required")
        check(type(limit) is int and 1 <= limit <= 200, "invalid", "Bounded result limit required")
        if reviewer == "concierge":
            shape(authorization, ("approved_by", "start", "end", "purpose"))
            check(authorization["approved_by"] == "owner" and start >= authorization["start"] and end <= authorization["end"],
                  "forbidden", "Explicit bounded owner authorisation required")
            text(authorization["purpose"])
        current = self.clock()
        cutoff = max(start, current - self.settings["feedback_seconds"])
        rows = self.db.execute("SELECT body FROM feedback_content WHERE received>=? AND received<=? ORDER BY received,id LIMIT ?", (cutoff, end, limit + 1)).fetchall()
        prompts = self.db.execute("SELECT state,count(*) AS n FROM feedback_prompts WHERE claimed>=? AND claimed<=? GROUP BY state", (cutoff, end)).fetchall()
        # General events contain only lifecycle/continuity metadata, never answers.
        events = self.db.execute("SELECT kind,subject,body FROM events WHERE CAST(strftime('%s',event_time) AS REAL)>=? "
                                 "AND CAST(strftime('%s',event_time) AS REAL)<=? ORDER BY receipt_time,id LIMIT 1001", (start, end)).fetchall()
        sessions, usage = set(), {"new_threads": 0, "accepted_handoffs": 0, "resumed_threads": "unknown; no live adapter"}
        for event in events[:1000]:
            envelope = json.loads(event["body"])
            # Rejected events cannot count as observed successful use.
            successful = self.db.execute("SELECT result FROM events WHERE id=?", (envelope["event"]["id"],)).fetchone()
            if not json.loads(successful[0])["ok"]:
                continue
            if envelope["actor"]["session"]:
                sessions.add(envelope["actor"]["session"])
            if event["kind"] == "register":
                sessions.add(event["subject"])
            if event["kind"] == "open":
                usage["new_threads"] += 1
            if event["kind"] == "accept":
                usage["accepted_handoffs"] += 1
        known_sessions = [self._record("sessions", session) for session in sessions]
        providers = sorted({s["identity"]["provider"] for s in known_sessions if s["identity"]})
        return {"feedback": [json.loads(r[0]) for r in rows[:limit]], "truncated": len(rows) > limit,
                "prompt_states": {r["state"]: r["n"] for r in prompts}, "window": [start, end],
                "coverage": {"registered_providers": providers, "live_adapters": [], "observed_usage": usage,
                             "participating_sessions": sorted(sessions), "event_coverage_truncated": len(events) > 1000,
                             "limits": "Offline fixtures only; unregistered use/non-use unknown. No overall adoption rate or time saved inferred."},
                "improvement": "Concierge may propose one evidence-linked change and success signal; owner decides"}


class FixtureOutbox:
    """In-memory transport fixture. No filesystem watcher, live hook or socket."""
    def __init__(self, bound_session, producer):
        self.bound_session, self.producer, self.rows = bound_session, producer, {}

    def enqueue(self, envelope, at):
        event = json.loads(encoded(envelope))
        old = self.rows.get(event["id"])
        check(old is None or old["event"] == event, "replay_conflict", "Outbox event changed")
        if old is None:
            self.rows[event["id"]] = {"event": event, "created": at, "acknowledged": None}

    def collect(self, service, event_id):
        row = self.rows[event_id]
        result = service.submit(row["event"], bound_session=self.bound_session, producer=self.producer)
        if result["ok"]:
            row["acknowledged"] = service.clock()
        return result

    def maintain(self, service):
        lost = []
        for event_id, row in list(self.rows.items()):
            if row["acknowledged"] is not None:
                expire = service.clock() - row["acknowledged"] >= service.settings["acknowledged_outbox_seconds"]
            else:
                expire = service.clock() - row["created"] >= service.settings["pending_outbox_seconds"]
                if expire:
                    lost.append({"id": event_id, "state": "lost-capture", "saved": False})
            if expire:
                del self.rows[event_id]
        return lost

    def delete(self, event_ids):
        for event_id in event_ids:
            self.rows.pop(event_id, None)

"""C1 acceptance tests: temporary local stores only, no installed hooks or services."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4


ENGINE = Path(__file__).resolve().parents[1] / "scripts" / "continuity.py"
sys.path.insert(0, str(ENGINE.parent))
spec = importlib.util.spec_from_file_location("continuity", ENGINE)
c = importlib.util.module_from_spec(spec)
sys.modules["continuity"] = c
spec.loader.exec_module(c)
TIME = "2026-09-28T12:00:00+00:00"


def uid():
    return str(uuid4())


def content(next_action="Inspect the acceptance evidence"):
    return {"position": "Fixture work checkpointed", "next_action": next_action,
            "decisions": [], "evidence": [], "questions": [], "blockers": []}


def action(name, category="required-now", actor="proposed", session=None, dependencies=()):
    return {"id": name, "text": name, "category": category,
            "actor": {"status": actor, "name": "André" if actor != "unknown" else None,
                      "evidence": [{"type": "fixture", "ref": "agreed-route"}] if actor == "confirmed" else []},
            "destination": {"status": "verified" if session else "unknown", "session": session},
            "dependencies": list(dependencies), "evidence": [], "contribution": "Finish the agreed condition"}


def observation(key, claim, date="2026-09-28T10:00:00+00:00", **extra):
    return {"key": key, "claim": claim, "observed_at": date,
            "source": {"type": "fixture", "ref": key}, "status": "supported", **extra}


class ContinuityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "store" / "continuity.sqlite3"
        c.Store.initialize(self.path)
        self.store = c.Store(self.path)
        self.sequence = 0
        self.sender, self.receiver = self.register(), self.register()
        self.thread = self.open_thread()

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def actor(self, session=None, kind=None):
        return {"producer": f"fixture:{kind or ('session' if session else 'operator')}:{session or 'trusted'}",
                "kind": kind or ("session" if session else "operator"), "session": session}

    def event(self, kind, subject, payload, time=TIME):
        self.sequence += 1
        return {"id": uid(), "sequence": self.sequence, "kind": kind, "subject": subject,
                "time": time, "payload": payload}

    def emit(self, kind, subject, payload, session=None, producer_kind=None, ok=True, time=TIME):
        event = self.event(kind, subject, payload, time)
        result = self.store.apply(event, self.actor(session, producer_kind))
        self.assertEqual(ok, result["ok"], result)
        return result["value"] if ok else result["error"]

    def register(self, identity=True):
        session = uid()
        self.emit("register", session, {"role": "fixture-worker", "environment": "inert-c1",
                  "launch_attempt": uid(), "profile": "fixture-only",
                  "identity": {"provider": "fixture", "session_id": uid(), "resume_ref": "fixture://no-launch",
                               "evidence": "inert fixture identity"} if identity else None})
        return session

    def open_thread(self, outcome_id=None, origin=None, coordinator=None):
        thread = uid()
        p = {"title": "Thinking without a ticket", "outcome": "Reach an evidenced decision",
             "links": [], "coordinator": coordinator or self.sender}
        if outcome_id:
            p["outcome_id"] = outcome_id
        if origin:
            p["origin"] = origin
        self.emit("open", thread, p)
        return thread

    def prepare(self, handoff=None, revision=0, receiver=None, thread=None,
                mode="service", exit_condition="A verified destination or explicit unknown is returned"):
        thread = thread or self.thread
        t = self.store.get("threads", thread)
        return self.emit("prepare", handoff or uid(), {"thread": thread,
                         "expected_thread_revision": t["revision"], "receiver": receiver or self.receiver,
                         "brief": {"ref": "fixture://brief", "outcome": "Reach the decision", "sources": [],
                                   "decisions": [], "scope": "Inert records", "exclusions": "All real execution",
                                   "next_action": "Inspect fixture", "destination": "fixture receiver",
                                   "mode": mode, "exit_condition": exit_condition},
                         "authority": "Record-only fixture; no runtime authority", "expected_handoff_revision": revision},
                         session=t["coordinator"])

    def sent(self, handoff=None):
        h = handoff or self.prepare()
        return self.emit("send", h["id"], {"revision": h["revision"], "expected_state_revision": h["state_revision"], "resolution": None}, session=h["sender"])

    def accept_payload(self, h):
        t = self.store.get("threads", h["thread"])
        return {"revision": h["revision"], "expected_state_revision": h["state_revision"],
                "expected_thread_revision": t["revision"], "previous_coordinator": h["sender"],
                "checkpoint_id": uid(), "content": content(), "understanding": "Inert acceptance only"}

    def checkpoint(self, thread=None, body=None, **extra):
        t = self.store.get("threads", thread or self.thread)
        return self.emit("checkpoint", uid(), {"thread": t["id"], "expected_revision": t["revision"],
                         "assignment_revision": t["assignment_revision"], "content": body or content(), **extra}, session=t["coordinator"])

    def test_end_to_end_clarification_accept_park_rediscover(self):
        h = self.sent()
        self.assertFalse(self.store.query(self.thread)[0]["suggest_intake_closure"])
        h = self.emit("clarify", h["id"], {"revision": 1, "expected_state_revision": 1,
                      "questions": ["Does the scope include live launch?"]}, self.receiver)
        h = self.emit("send", h["id"], {"revision": 1, "expected_state_revision": 2,
                      "resolution": {"answer": "No. Records only.", "remaining_questions": ["Discuss next scope with André"],
                                     "direct_discussion": True, "authority_resolved": True}}, self.sender)
        self.emit("accept", h["id"], self.accept_payload(h), self.receiver)
        self.checkpoint(body=content("Review C1 with André"), disposition="parked", human_approval="fixture André park decision")
        self.store.close()
        self.store = c.Store(self.path, readonly=True)
        row = self.store.query(self.thread)[0]
        self.assertTrue(row["suggest_intake_closure"])
        self.assertEqual(row["thread"]["coordinator"], self.receiver)
        self.assertEqual(row["thread"]["disposition"], "parked")
        self.assertEqual(row["checkpoint"]["content"]["next_action"], "Review C1 with André")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM checkpoints").fetchone()[0], 2)

    def test_exact_event_replay_and_mismatched_replay(self):
        h = self.sent()
        event = self.event("accept", h["id"], self.accept_payload(h))
        actor = self.actor(self.receiver)
        result = self.store.apply(event, actor)
        self.assertTrue(result["ok"])
        self.assertEqual(result, self.store.apply(event, actor))
        changed = copy.deepcopy(event)
        changed["payload"]["understanding"] = "Changed authority"
        with self.assertRaisesRegex(c.Error, "different content"):
            self.store.apply(changed, actor)
        changed = {**event, "id": uid()}
        with self.assertRaises(c.Error):
            self.store.apply(changed, actor)
        self.assertEqual(self.store.get("threads", self.thread)["assignment_revision"], 1)

    def test_duplicate_registration_and_provider_collision(self):
        s = self.store.get("sessions", self.sender)
        p = {k: s[k] for k in ("role", "environment", "launch_attempt", "profile", "identity")}
        self.emit("register", self.sender, p)
        error = self.emit("register", uid(), {**p, "launch_attempt": uid()}, ok=False)
        self.assertEqual(error["code"], "conflict")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM sessions").fetchone()[0], 2)

    def test_receiver_channel_and_previous_coordinator_are_required(self):
        h = self.sent()
        payload = self.accept_payload(h)
        self.assertEqual(self.emit("accept", h["id"], payload, self.sender, ok=False)["code"], "forbidden")
        payload["previous_coordinator"] = self.receiver
        self.assertEqual(self.emit("accept", h["id"], payload, self.receiver, ok=False)["code"], "stale")
        self.assertEqual(self.store.get("threads", self.thread)["coordinator"], self.sender)

    def test_revised_assignment_invalidates_old_delivery(self):
        old = self.sent()
        new = self.prepare(old["id"], revision=1)
        self.assertEqual(new["revision"], 2)
        self.assertEqual(self.emit("accept", old["id"], self.accept_payload(old), self.receiver, ok=False)["code"], "stale")
        self.assertEqual(self.store.get("handoffs", old["id"], 1)["state"], "sent")

    def test_interaction_modes_are_accepted_with_exact_exit_conditions(self):
        examples = (
            ("collaboration", "André accepts the agreed MVP list and launch sequence"),
            ("facilitation", "Recipient demonstrates the bounded integration approach independently"),
            ("service", "Return a verified destination or explicit unknown with discovery action"),
        )
        for mode, exit_condition in examples:
            with self.subTest(mode=mode):
                thread = self.open_thread()
                handoff = self.sent(self.prepare(thread=thread, mode=mode, exit_condition=exit_condition))
                self.emit("accept", handoff["id"], self.accept_payload(handoff), self.receiver)
                row = self.store.query(thread)[0]
                self.assertEqual(row["engagement"]["mode"], mode)
                self.assertEqual(row["engagement"]["exit_condition"], exit_condition)
                self.assertEqual(row["engagement"]["source_handoff_revision"], handoff["revision"])
                self.assertIsNone(row["engagement_exit"])
                self.assertIn("Intended mode: " + mode, c.render([row]))
                self.assertIn("Exit condition: " + exit_condition, c.render([row]))

    def test_mode_revision_preserves_original_agreement_and_revises_assignment(self):
        original = self.prepare(mode="service", exit_condition="Return a destination")
        revised = self.prepare(handoff=original["id"], revision=1, mode="collaboration",
                               exit_condition="Agree the approach with André")
        self.assertEqual(self.store.get("handoffs", original["id"], 1)["brief"]["mode"], "service")
        self.assertEqual(revised["revision"], 2)
        sent = self.sent(revised)
        self.emit("accept", sent["id"], self.accept_payload(sent), self.receiver)
        t = self.store.get("threads", self.thread)
        new = self.emit("revise-engagement", uid(), {"thread": self.thread,
                        "expected_thread_revision": t["revision"], "expected_assignment_revision": 1,
                        "expected_engagement_revision": 1, "mode": "facilitation",
                        "exit_condition": "Recipient applies the approach unaided", "reason": "Discovery changed the engagement",
                        "authority": [{"type": "fixture", "ref": "André and receiver agreed revision"}]}, self.receiver)
        self.assertEqual((new["revision"], new["assignment_revision"]), (2, 2))
        self.assertEqual([e["mode"] for e in self.store.query(self.thread)[0]["engagement_history"]],
                         ["collaboration", "facilitation"])
        self.assertEqual(self.store.get("handoffs", sent["id"], 2)["brief"]["mode"], "collaboration")
        stale = content()
        stale["engagement_exit"] = {"revision": 1, "assessment": "met",
                                    "evidence": [{"type": "fixture", "ref": "old mode only"}],
                                    "remaining": "", "next_action": ""}
        self.assertEqual(self.emit("checkpoint", uid(), {"thread": self.thread,
                         "expected_revision": 2, "assignment_revision": 2,
                         "content": stale}, self.receiver, ok=False)["code"], "stale")

    def test_unmet_exit_remains_visible_after_thread_closure(self):
        handoff = self.sent(self.prepare(mode="facilitation", exit_condition="Recipient can apply the pattern"))
        self.emit("accept", handoff["id"], self.accept_payload(handoff), self.receiver)
        body = content("Return the open pattern question to André")
        body["engagement_exit"] = {"revision": 1, "assessment": "unmet",
                                   "evidence": [{"type": "fixture", "ref": "reviewed design still has open question"}],
                                   "remaining": "Recipient cannot apply the pattern independently",
                                   "next_action": "Return the question to André"}
        self.checkpoint(body=body, disposition="closed", human_approval="fixture close decision")
        row = self.store.query(self.thread)[0]
        self.assertEqual(row["engagement_exit"]["assessment"], "unmet")
        self.assertIn("engagement exit not met; closure does not prove exit", row["issues"])
        self.assertIn("Actual exit: unmet", c.render([row]))
        self.assertIn("Exit evidence:", c.render([row]))
        self.assertIn("Exit gap: Recipient cannot apply the pattern independently", c.render([row]))
        self.assertIn("Exit next action: Return the question to André", c.render([row]))

    def test_closed_session_without_exit_evidence_stays_unknown(self):
        handoff = self.sent(self.prepare())
        self.emit("accept", handoff["id"], self.accept_payload(handoff), self.receiver)
        self.checkpoint(body=content("Discover the missing result"), disposition="closed",
                        human_approval="fixture close decision")
        self.emit("observe", self.receiver, {"expected_revision": 0, "state": "exited",
                  "location": None, "observed_at": TIME, "source": "fixture process exit"},
                  producer_kind="observer")
        row = self.store.query(self.thread)[0]
        self.assertIsNone(row["engagement_exit"])
        self.assertIn("engagement exit evidence missing; closure does not prove exit", row["issues"])
        self.assertIn("Actual exit: unknown — no exit evidence", c.render([row]))

    def test_one_clarification_round_and_unresolved_authority(self):
        h = self.sent()
        self.emit("clarify", h["id"], {"revision": 1, "expected_state_revision": 1, "questions": ["Authority?"]}, self.receiver)
        h = self.emit("send", h["id"], {"revision": 1, "expected_state_revision": 2,
                      "resolution": {"answer": "Still unresolved", "remaining_questions": ["Authority?"],
                                     "direct_discussion": True, "authority_resolved": False}}, self.sender)
        self.assertEqual(self.emit("accept", h["id"], self.accept_payload(h), self.receiver, ok=False)["code"], "authority")
        self.assertEqual(self.emit("clarify", h["id"], {"revision": 1, "expected_state_revision": 3,
                         "questions": ["Again?"]}, self.receiver, ok=False)["code"], "transition")
        self.emit("cancel", h["id"], {"revision": 1, "expected_state_revision": 3, "reason": "Discuss directly with André"}, self.sender)

    def test_two_checkpoint_writers_conflict_without_lost_history(self):
        events = [self.event("checkpoint", uid(), {"thread": self.thread, "expected_revision": 0,
                  "assignment_revision": 0, "content": content(str(i))}) for i in range(2)]
        results = self.parallel(events, [self.actor(self.sender)] * 2)
        self.assertEqual(sorted(r["ok"] for r in results), [False, True])
        self.checkpoint(body=content("Reconciled after fresh read"))
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM checkpoints").fetchone()[0], 2)
        self.assertEqual(self.store.get("threads", self.thread)["revision"], 2)

    def parallel(self, events, actors):
        processes = []
        for event, actor in zip(events, actors):
            command = [sys.executable, str(ENGINE), "--db", str(self.path), "apply", "--producer", actor["producer"], "--kind", actor["kind"]]
            if actor["session"]:
                command += ["--session", actor["session"]]
            proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            proc.stdin.write(json.dumps(event))
            proc.stdin.close()
            processes.append(proc)
        results = []
        for proc in processes:
            output = proc.stdout.read()
            err = proc.stderr.read()
            proc.wait(timeout=10)
            self.assertIn(proc.returncode, (0, 2), err)
            results.append(json.loads(output))
            proc.stdout.close()
            proc.stderr.close()
        return results

    def test_competing_accepts_do_not_transfer_twice(self):
        third = self.register()
        hs = [self.sent(), self.sent(self.prepare(receiver=third))]
        events = [self.event("accept", h["id"], self.accept_payload(h)) for h in hs]
        results = self.parallel(events, [self.actor(h["receiver"]) for h in hs])
        self.assertEqual(sorted(r["ok"] for r in results), [False, True])
        self.assertEqual(self.store.get("threads", self.thread)["assignment_revision"], 1)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM checkpoints").fetchone()[0], 1)

    def test_previous_owner_cannot_overwrite_new_checkpoint(self):
        h = self.sent()
        self.emit("accept", h["id"], self.accept_payload(h), self.receiver)
        error = self.emit("checkpoint", uid(), {"thread": self.thread, "expected_revision": 1,
                          "assignment_revision": 0, "content": content("Stale")}, self.sender, ok=False)
        self.assertEqual(error["code"], "forbidden")

    def test_crash_before_accept_commit_and_after_commit_replay(self):
        h = self.sent()
        event = self.event("accept", h["id"], self.accept_payload(h))
        actor = self.actor(self.receiver)
        script = """
import importlib.util,json,os,sys
sys.path.insert(0,os.path.dirname(sys.argv[1]))
spec=importlib.util.spec_from_file_location('c',sys.argv[1]); c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
s=c.Store(sys.argv[2]); event,actor=json.loads(sys.stdin.read())
if sys.argv[3]=='before':
 original=s.update
 def interrupted(table,body,**columns):
  original(table,body,**columns)
  if table=='threads': os._exit(81)
 s.update=interrupted
s.apply(event,actor)
os._exit(82)
"""
        for phase, status in (("before", 81), ("after", 82)):
            proc = subprocess.run([sys.executable, "-c", script, str(ENGINE), str(self.path), phase],
                                  input=json.dumps([event, actor]), capture_output=True, text=True, timeout=10)
            self.assertEqual(proc.returncode, status, proc.stderr)
            t = self.store.get("threads", self.thread)
            self.assertEqual(t["coordinator"], self.sender if phase == "before" else self.receiver)
            self.assertEqual(self.store.get("handoffs", h["id"])["state"], "sent" if phase == "before" else "accepted")
        self.assertTrue(self.store.apply(event, actor)["ok"])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM checkpoints").fetchone()[0], 1)

    def test_exit_and_missing_identity_never_complete_work(self):
        unknown = self.register(identity=False)
        thread = self.open_thread(coordinator=unknown)
        self.checkpoint(thread)
        for revision, state in enumerate(("available", "exited")):
            self.emit("observe", unknown, {"expected_revision": revision, "state": state, "location": "fixture:p1",
                      "observed_at": f"2026-09-28T1{revision}:00:00+00:00", "source": "fixture exit callback"}, producer_kind="observer")
        row = self.store.query(thread)[0]
        self.assertEqual(row["thread"]["disposition"], "open")
        self.assertIsNotNone(row["checkpoint"])
        self.assertIn("provider identity/resume reference unknown", row["issues"])
        self.assertFalse(row["suggest_intake_closure"])

    def test_exact_links_return_candidates_without_merging(self):
        link = {"type": "linear", "ref": "fixture-123"}
        for _ in range(2):
            self.emit("open", uid(), {"title": "Distinct outcome", "outcome": "Independent work",
                                     "coordinator": self.sender, "links": [link]})
        self.assertEqual(len(self.store.query(link=link)), 2)
        self.assertEqual(len(self.store.query(link={**link, "ref": "fixture-12"})), 0)

    def test_readonly_missing_corrupt_version_backup_permissions_and_legacy(self):
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.path.parent.stat().st_mode & 0o777, 0o700)
        legacy = Path(self.temp.name) / "legacy.json"
        legacy.write_text('{"next":"untouched","resumeId":"old"}')
        before = legacy.read_bytes()
        self.store.query()
        target = Path(self.temp.name) / "backup" / "snapshot.sqlite3"
        self.store.backup(target)
        with self.assertRaisesRegex(c.Error, "Sealed backup"):
            c.Store(target, readonly=True)
        backup = c.Store(target, readonly=True, _allow_snapshot=True)
        self.assertEqual(backup.query(), self.store.query())
        backup.close()
        self.assertEqual(legacy.read_bytes(), before)
        with self.assertRaises(c.Error):
            c.Store(self.path.parent / "missing.sqlite3")
        self.assertFalse((self.path.parent / "missing.sqlite3").exists())
        db = sqlite3.connect(target)
        db.execute("PRAGMA user_version=999")
        db.close()
        with self.assertRaisesRegex(c.Error, "Unsupported schema"):
            c.Store(target)
        db = sqlite3.connect(target)
        db.execute("PRAGMA user_version=2")
        db.execute("DROP TABLE events")
        db.close()
        with self.assertRaisesRegex(c.Error, "Schema differs"):
            c.Store(target)

    def test_launch_requests_are_strict_inert_records(self):
        p = {"thread": self.thread, "handoff": None, "role": "concierge", "profile": "fixture-only",
             "mode": "create", "session": None, "sources": [], "human_approval": "fixture approval"}
        self.assertEqual(self.emit("launch-request", uid(), {**p, "command": "forbidden"}, ok=False)["code"], "invalid")
        request = self.emit("launch-request", uid(), p)
        self.assertTrue(request["inert"])
        self.assertEqual(self.emit("launch-result", request["id"], {"expected_revision": 0, "result": "fulfilled", "reason": "No"}, producer_kind="launcher", ok=False)["code"], "invalid")
        self.emit("launch-result", request["id"], {"expected_revision": 0, "result": "refused", "reason": "Unsupported live C1 launcher"}, producer_kind="launcher")

    def outcome(self, conditions=None):
        outcome = uid()
        self.emit("outcome-scope", outcome, {"expected_revision": 0, "title": "Production House fixture",
                  "conditions": conditions or [{"id": "done", "text": "Agreed decision evidenced"}],
                  "authority": [{"type": "fixture", "ref": "André agreed scope 2026-09-28"}], "reason": "Initial agreed scope"}, self.sender)
        return outcome

    def production_fixture(self):
        fixture = json.loads((Path(__file__).parent / "fixtures" / "production-house.json").read_text())
        outcome = self.outcome(fixture["conditions"])
        first = self.open_thread(outcome_id=outcome)
        second = self.open_thread(outcome_id=outcome, coordinator=self.receiver)
        body = content()
        body.update(fixture["checkpoint"])
        body.pop("next_action")
        self.checkpoint(first, body)
        return outcome, first, second

    # Extension acceptance 1: outcomes precede the several contributing sessions.
    def test_extension_1_groups_sessions_under_one_outcome(self):
        outcome, first, second = self.production_fixture()
        rows = self.store.outcome_view(as_of=TIME)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome"]["id"], outcome)
        self.assertEqual({d["thread"]["id"] for d in rows[0]["threads"]}, {first, second})
        self.assertEqual(len({d["session"]["id"] for d in rows[0]["threads"]}), 2)

    # Extension acceptance 2: merge facts are not release completion evidence.
    def test_extension_2_four_conditions_cannot_complete_from_merged_feature(self):
        outcome, _, _ = self.production_fixture()
        row = self.store.outcome_view(outcome, TIME)[0]
        self.assertEqual(len(row["conditions"]), 4)
        self.assertFalse(row["completed"])
        self.assertEqual(row["evidence"]["qc-feature-prs"]["claim"], "Core #46 and portal #56 merged September 24; production availability unproven")
        error = self.emit("complete-outcome", outcome, {"expected_revision": 1, "scope_revision": 1,
                          "acceptance_evidence": [{"type": "fixture", "ref": "merged-PR"}]}, self.sender, ok=False)
        self.assertEqual(error["code"], "incomplete")

    # Extension acceptance 3: corrections use observation time, preserve holds.
    def test_extension_3_newer_correction_removes_false_dependency_preserves_hold(self):
        outcome, first, second = self.production_fixture()
        body = content()
        body.update(actions=[], observations=[observation("ENG-2543", "Old presumed portal blocker", "2026-09-23T10:00:00+00:00", blocks=True),
                                               observation("qc-feature-prs", "PRs still open", "2026-09-23T10:00:00+00:00")])
        body.pop("next_action")
        self.checkpoint(second, body)
        row = self.store.outcome_view(outcome, TIME)[0]
        qc = next(a for a in row["actions"] if a["id"] == "qc-verify")
        self.assertNotIn("ENG-2543", qc["waiting_for"])
        self.assertFalse(row["evidence"]["ENG-2543"]["blocks"])
        self.assertIn("SSO-286", next(a for a in row["actions"] if a["id"] == "held-sso")["waiting_for"])
        self.assertIn("deploy order", row["evidence"]["SSO-286"]["hold_reason"])
        self.assertIn("merged September 24", row["evidence"]["qc-feature-prs"]["claim"])

    # Extension acceptance 4: parallel actionable, waiting and optional suggestions.
    def test_extension_4_parallel_actions_preserve_actor_and_category(self):
        outcome, _, _ = self.production_fixture()
        actions = self.store.outcome_view(outcome, TIME)[0]["actions"]
        self.assertGreaterEqual(sum(a["category"] == "required-now" for a in actions), 2)
        self.assertIn("waiting", {a["category"] for a in actions})
        self.assertIn("optional-follow-up", {a["category"] for a in actions})
        self.assertIn("proposed", {a["actor"]["status"] for a in actions})
        self.assertIn("unknown", {a["actor"]["status"] for a in actions})

    # Extension acceptance 5: accepted branch retains origin, separate finish line.
    def test_extension_5_optional_branch_acceptance_preserves_original_scope(self):
        outcome = self.outcome()
        original = self.open_thread(outcome_id=outcome)
        before = self.store.get("outcomes", outcome)
        other = self.outcome()
        branch = self.open_thread(outcome_id=other, origin=original)
        h = self.sent(self.prepare(thread=branch))
        self.emit("accept", h["id"], self.accept_payload(h), self.receiver)
        self.assertEqual(self.store.get("threads", branch)["origin"], original)
        self.assertEqual(self.store.get("outcomes", outcome), before)

    # Extension acceptance 6: explicit completion; optional work does not reopen.
    def test_extension_6_completed_outcome_closes_with_only_optional_suggestions(self):
        outcome = self.outcome()
        thread = self.open_thread(outcome_id=outcome)
        body = content()
        body.pop("next_action")
        body.update(actions=[action("Consider optional explanation", "optional-follow-up")],
                    observations=[observation("acceptance", "Agreed decision evidenced")], scope_revision=1,
                    conditions=[{"id": "done", "state": "met", "evidence": ["acceptance"], "remaining": ""}])
        self.checkpoint(thread, body)
        self.emit("complete-outcome", outcome, {"expected_revision": 1, "scope_revision": 1,
                  "acceptance_evidence": [{"type": "fixture", "ref": "André explicit acceptance"}]}, self.sender)
        row = self.store.outcome_view(outcome, TIME)[0]
        self.assertTrue(row["ready_to_close"])
        self.assertTrue(row["completed"])
        self.assertIsNone(row["remaining_acceptance"])
        self.assertEqual(row["actions"][0]["category"], "optional-follow-up")

    # Extension acceptance 7: absence of proof, stale evidence and missing sessions.
    def test_extension_7_stale_unknown_missing_sessions_prompt_discovery(self):
        outcome, _, _ = self.production_fixture()
        row = self.store.outcome_view(outcome, "2026-10-28T12:00:00+00:00")[0]
        self.assertTrue(all(e["stale"] for e in row["evidence"].values()))
        self.assertTrue(all("discover existing session" in a["destination_note"] for a in row["actions"]))
        self.assertFalse(row["completed"])
        self.assertTrue(any(c["state"] == "unknown" for c in row["conditions"]))

    # Extension acceptance 8: read-only derived view has no execution side effects.
    def test_extension_8_rendering_is_readonly_and_advisory(self):
        outcome, _, _ = self.production_fixture()
        before = self.path.read_bytes()
        readonly = c.Store(self.path, readonly=True)
        rows = readonly.outcome_view(outcome, TIME)
        rendered = c.render_outcomes(rows)
        readonly.close()
        self.assertEqual(self.path.read_bytes(), before)
        self.assertIn("Recommendations grant no execution authority", rendered)
        self.assertEqual(rows[0]["record_owner"], "Concierge")
        self.assertEqual(rows[0]["advisory_owner"], "Danny")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM launch_requests").fetchone()[0], 0)

    def test_scope_revision_and_legacy_single_action_readability(self):
        outcome = self.outcome()
        thread = self.open_thread(outcome_id=outcome)
        self.checkpoint(thread, content("Review the exact corrected findings"))
        row = self.store.outcome_view(outcome, TIME)[0]
        self.assertEqual(row["actions"][0]["text"], "Review the exact corrected findings")
        self.assertEqual(row["actions"][0]["actor"]["status"], "unknown")
        self.emit("outcome-scope", outcome, {"expected_revision": 1, "title": "Revised scope",
                  "conditions": [{"id": "two", "text": "Two houses and observability"}],
                  "authority": [{"type": "fixture", "ref": "new agreement"}], "reason": "Older one-house scope superseded explicitly"}, self.sender)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM outcome_scopes WHERE id=?", (outcome,)).fetchone()[0], 2)
        bad = content()
        bad.update(scope_revision=1, conditions=[{"id": "done", "state": "met", "evidence": ["x"], "remaining": ""}])
        t = self.store.get("threads", thread)
        self.assertEqual(self.emit("checkpoint", uid(), {"thread": thread, "expected_revision": t["revision"],
                         "assignment_revision": 0, "content": bad}, self.sender, ok=False)["code"], "stale")

    def test_direct_entry_lifecycle_fixture_and_verified_provider_binding(self):
        from continuity_fixtures import FixtureProducer
        fixture = FixtureProducer(self.store)
        session, thread = fixture.direct_entry()
        self.assertEqual(self.store.query(thread)[0]["destination"]["id"], session)
        fixture.observe(session, "exited")
        self.assertEqual(self.store.get("threads", thread)["disposition"], "open")
        self.assertEqual(fixture.launch_fixture(thread)["result"], "refused")
        self.assertEqual(fixture.launch_fixture(thread, mode="resume", session=session)["result"], "unknown")
        with self.assertRaises(ValueError):
            fixture.launch_fixture(thread, role="unapproved-role")
        unknown = fixture.session(supported=False)
        identity = {"provider": "fixture", "session_id": uid(), "resume_ref": "fixture://verified", "evidence": "Verified inert binding"}
        self.emit("bind-provider", unknown, {"expected_revision": 0, "identity": identity}, producer_kind="launcher")
        self.assertEqual(self.store.get("sessions", unknown)["identity"], identity)
        self.assertEqual(self.emit("bind-provider", unknown, {"expected_revision": 1, "identity": identity}, producer_kind="launcher", ok=False)["code"], "conflict")

    def test_cli_errors_are_json_and_missing_store_is_not_created(self):
        missing = self.path.parent / "missing.sqlite3"
        proc = subprocess.run([sys.executable, str(ENGINE), "--db", str(missing), "view"], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(json.loads(proc.stdout)["error"]["code"], "missing_store")
        self.assertFalse(missing.exists())
        proc = subprocess.run([sys.executable, str(ENGINE), "--db", str(self.path), "apply", "--producer", "fixture", "--kind", "operator"], input="not json", capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(json.loads(proc.stdout)["error"]["code"], "invalid")


if __name__ == "__main__":
    unittest.main()

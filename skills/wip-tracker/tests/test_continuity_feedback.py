"""Feedback fixture protocol, retention and recovery; no real prompts or capture."""

import copy
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import unittest

import test_continuity as base
from continuity_feedback import Feedback, FeedbackError, FixtureOutbox, DEFAULTS


class FeedbackTest(base.ContinuityTest):
    def setUp(self):
        super().setUp()
        self.time = 1790596800.0  # Fixed trusted collector fixture clock.
        self.feedback = Feedback(self.store, clock=lambda: self.time, simulate=True)
        self.outcome_id = self.outcome()
        self.feedback_thread = self.open_thread(outcome_id=self.outcome_id)
        self.cp = self.checkpoint(self.feedback_thread)["checkpoint"]
        self.outbox = FixtureOutbox(self.sender, "fixture-outbox:" + self.sender)

    def envelope(self, kind, payload):
        self.sequence += 1
        return {"id": base.uid(), "sequence": self.sequence, "kind": kind, "payload": payload}

    def submit(self, kind, payload, session=None):
        event = self.envelope(kind, payload)
        return self.feedback.submit(event, bound_session=session or self.sender, producer="fixture-outbox:" + (session or self.sender))

    def claim_payload(self, **changes):
        return {"request": base.uid(), "outcome": self.outcome_id, "thread": self.feedback_thread,
                "checkpoint": self.cp, "natural_pause": True, "other_question_pending": False, **changes}

    def shown(self):
        payload = self.claim_payload()
        result = self.submit("claim", payload)
        self.assertEqual(result["state"], "claimed", result)
        request = {"request": payload["request"], "outcome": self.outcome_id}
        self.assertEqual(self.submit("shown", request)["state"], "shown")
        return request

    def answer(self, request, **changes):
        return {**request, "rating": "Mixed", "quote": None, "context": "Resumed the agreed fixture outcome",
                "interpretation": None, "capability": None, "evidence": [], **changes}

    def test_defaults_disabled_and_pause_eligibility_unknown_omits(self):
        self.assertEqual(DEFAULTS["status"], "proposed-disabled")
        self.assertEqual(DEFAULTS["cooldown_seconds"], 86400)
        service = Feedback(self.store, clock=lambda: self.time)
        result = service.submit(self.envelope("claim", self.claim_payload()), bound_session=self.sender, producer="fixture")
        self.assertEqual(result["state"], "omit")
        for change in ({"natural_pause": False}, {"other_question_pending": True}):
            self.assertEqual(self.submit("claim", self.claim_payload(**change))["state"], "omit")
        self.assertEqual(self.submit("claim", self.claim_payload(natural_pause=None))["error"], "invalid")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_prompts").fetchone()[0], 0)

    def test_concurrent_claims_same_outcome_and_shared_cooldown(self):
        second = self.open_thread(outcome_id=self.outcome_id, coordinator=self.receiver)
        cp2 = self.checkpoint(second)["checkpoint"]
        events = [self.envelope("claim", self.claim_payload()),
                  self.envelope("claim", self.claim_payload(thread=second, checkpoint=cp2))]
        script = """
import sys,json
sys.path.insert(0,sys.argv[1])
from continuity import Store
from continuity_feedback import Feedback
e,s=json.loads(sys.stdin.read()); db=Store(sys.argv[2])
print(json.dumps(Feedback(db,clock=lambda:float(sys.argv[3]),simulate=True).submit(e,bound_session=s,producer='fixture:'+s)))
"""
        processes = []
        for event, session in zip(events, (self.sender, self.receiver)):
            proc = subprocess.Popen([sys.executable, "-c", script, str(base.ENGINE.parent), str(self.path), str(self.time)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            proc.stdin.write(json.dumps([event, session]))
            proc.stdin.close()
            processes.append(proc)
        results = []
        for proc in processes:
            output, err = proc.stdout.read(), proc.stderr.read()
            self.assertEqual(proc.wait(timeout=10), 0, err)
            results.append(json.loads(output))
            proc.stdout.close()
            proc.stderr.close()
        self.assertEqual(sorted(r["state"] for r in results), ["claimed", "omit"])
        other = self.outcome()
        thread = self.open_thread(outcome_id=other)
        checkpoint = self.checkpoint(thread)["checkpoint"]
        payload = self.claim_payload(outcome=other, thread=thread, checkpoint=checkpoint)
        self.assertEqual(self.submit("claim", payload)["state"], "omit")
        self.time += 86400
        self.assertEqual(self.submit("claim", payload)["state"], "claimed")
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")

    def test_claim_replay_crash_unconfirmed_unknown_and_no_retry(self):
        event = self.envelope("claim", self.claim_payload())
        first = self.feedback.submit(event, bound_session=self.sender, producer="fixture")
        self.assertTrue(first["display_permitted"])
        # Simulate lost acknowledgement/restart: durable claim consumes cooldown.
        self.store.close()
        self.store = base.c.Store(self.path)
        self.feedback = Feedback(self.store, clock=lambda: self.time, simulate=True)
        replay = self.feedback.submit(event, bound_session=self.sender, producer="fixture")
        self.assertFalse(replay["display_permitted"])
        self.time += 600
        self.feedback.maintain()
        row = self.store.db.execute("SELECT * FROM feedback_prompts").fetchone()
        self.assertEqual(row["state"], "unknown")
        self.assertEqual(self.submit("shown", {"request": row["id"], "outcome": self.outcome_id})["state"], "not_saved")
        self.time += 86400
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)

    def test_process_crash_before_and_after_claim_commit(self):
        event = self.envelope("claim", self.claim_payload())
        script = """
import sys,json,os
sys.path.insert(0,sys.argv[1])
from continuity import Store
from continuity_feedback import Feedback
db=Store(sys.argv[2]); f=Feedback(db,clock=lambda:float(sys.argv[3]),simulate=True)
e,s=json.loads(sys.stdin.read())
if sys.argv[4]=='before':
 original=f._dispatch
 def interrupted(*a):
  original(*a); os._exit(71)
 f._dispatch=interrupted
f.submit(e,bound_session=s,producer='fixture')
os._exit(72)
"""
        for phase, expected, count in (("before", 71, 0), ("after", 72, 1)):
            proc = subprocess.run([sys.executable, "-c", script, str(base.ENGINE.parent), str(self.path), str(self.time), phase],
                                  input=json.dumps([event, self.sender]), text=True, capture_output=True, timeout=10)
            self.assertEqual(proc.returncode, expected, proc.stderr)
            self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_prompts").fetchone()[0], count)
        self.assertFalse(self.feedback.submit(event, bound_session=self.sender, producer="fixture")["display_permitted"])

    def test_skip_silence_do_not_create_ratings_or_reprompt(self):
        request = self.shown()
        self.assertEqual(self.submit("skip", request)["state"], "skipped")
        self.assertEqual(self.submit("answer", self.answer(request))["state"], "not_saved")
        self.time += 86400
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")
        # A separate meaningful outcome can have silence, which is not satisfaction.
        self.outcome_id = self.outcome()
        self.feedback_thread = self.open_thread(outcome_id=self.outcome_id)
        self.cp = self.checkpoint(self.feedback_thread)["checkpoint"]
        request = self.shown()
        self.assertEqual(self.submit("silence", request)["state"], "unanswered")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)

    def test_spontaneous_unrated_suppresses_prompt_without_inventing_rating(self):
        p = self.answer({}, rating=None, quote="Too much ceremony")
        p.update(outcome=self.outcome_id, thread=self.feedback_thread, checkpoint=self.cp)
        result = self.submit("spontaneous", p)
        self.assertTrue(result["saved"])
        review = self.feedback.review(reviewer="owner", start=self.time - 1, end=self.time)
        self.assertIsNone(review["feedback"][0]["rating"])
        self.assertEqual(review["feedback"][0]["quote"], "Too much ceremony")
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")
        self.assertIsNone(self.store.db.execute("SELECT last_claim FROM feedback_control").fetchone()[0])

    def test_delayed_answer_binds_original_after_handoff_not_newer_outcome(self):
        request = self.shown()
        self.submit("silence", request)
        h = self.sent(self.prepare(thread=self.feedback_thread))
        self.emit("accept", h["id"], self.accept_payload(h), self.receiver)
        wrong = {**request, "outcome": self.outcome()}
        self.assertEqual(self.submit("answer", self.answer(wrong), session=self.receiver)["error"], "binding")
        result = self.submit("answer", self.answer(request), session=self.receiver)
        self.assertTrue(result["saved"], result)
        row = self.store.db.execute("SELECT * FROM feedback_content").fetchone()
        self.assertEqual(row["outcome"], self.outcome_id)
        self.assertEqual(json.loads(row["body"])["checkpoint"], self.cp)

    def test_expired_relationship_cannot_be_rebound(self):
        request = self.shown()
        self.time += 90 * 86400
        self.feedback.maintain()
        result = self.submit("answer", self.answer(request))
        self.assertFalse(result["saved"])
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")

    def test_bound_outbox_rejects_spoofed_ids_and_unauthorised_reads(self):
        event = self.envelope("claim", self.claim_payload())
        spoofed = FixtureOutbox(self.receiver, "fixture-receiver")
        spoofed.enqueue(event, self.time)
        self.assertEqual(spoofed.collect(self.feedback, event["id"])["error"], "binding")
        event = self.envelope("claim", {**self.claim_payload(), "session": self.sender})
        self.outbox.enqueue(event, self.time)
        self.assertEqual(self.outbox.collect(self.feedback, event["id"])["error"], "invalid")
        for role in ("danny", "session", "concierge"):
            with self.assertRaises(FeedbackError):
                self.feedback.review(reviewer=role, start=self.time - 1, end=self.time)
        with self.assertRaises(FeedbackError):
            self.feedback.delete([], actor="concierge")

    def test_failed_write_is_not_saved_or_acknowledged(self):
        request = self.shown()
        event = self.envelope("answer", self.answer(request))
        self.outbox.enqueue(event, self.time)
        readonly = base.c.Store(self.path, readonly=True)
        result = self.outbox.collect(Feedback(readonly, clock=lambda: self.time, simulate=True), event["id"])
        readonly.close()
        self.assertFalse(result["saved"])
        self.assertEqual(result["error"], "write_failed")
        self.assertIsNone(self.outbox.rows[event["id"]]["acknowledged"])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)
        self.assertTrue(self.outbox.collect(self.feedback, event["id"])["saved"])

    def test_answer_replay_collision_and_no_raw_general_events(self):
        request = self.shown()
        event = self.envelope("answer", self.answer(request, quote="A unique private fixture phrase"))
        result = self.feedback.submit(event, bound_session=self.sender, producer="fixture")
        self.assertTrue(result["saved"])
        self.assertEqual(result, self.feedback.submit(event, bound_session=self.sender, producer="fixture"))
        changed = copy.deepcopy(event)
        changed["payload"]["rating"] = "No"
        self.assertEqual(self.feedback.submit(changed, bound_session=self.sender, producer="fixture")["error"], "replay_conflict")
        rows = self.store.db.execute("SELECT body,result FROM events").fetchall()
        self.assertNotIn("unique private", str([tuple(r) for r in rows]))
        self.assertNotIn("unique private", str([tuple(r) for r in self.store.db.execute("SELECT * FROM feedback_diagnostics")]))

    def test_content_bounds_and_secret_like_rejection(self):
        request = self.shown()
        for change in ({"quote": "x" * 513}, {"context": "é" * 1025}, {"quote": "api_key=do-not-collect"}):
            self.assertFalse(self.submit("answer", self.answer(request, **change))["saved"])
        self.assertTrue(self.submit("answer", self.answer(request, quote="x" * 512, context="é" * 1024))["saved"])

    def test_authorised_bounded_review_reports_coverage_unknowns(self):
        self.assertTrue(self.submit("answer", self.answer(self.shown(), rating="Yes"))["saved"])
        approval = {"approved_by": "owner", "start": self.time - 60, "end": self.time,
                    "purpose": "One requested fixture review"}
        review = self.feedback.review(reviewer="concierge", start=self.time - 1, end=self.time, authorization=approval)
        self.assertEqual(len(review["feedback"]), 1)
        self.assertEqual(review["prompt_states"], {"answered": 1})
        self.assertEqual(review["coverage"]["live_adapters"], [])
        self.assertIn("unknown", review["coverage"]["limits"])

    def test_retention_outbox_diagnostics_content_and_dedupe(self):
        request = self.shown()
        event = self.envelope("answer", self.answer(request, quote="Expires later"))
        self.outbox.enqueue(event, self.time)
        self.assertTrue(self.outbox.collect(self.feedback, event["id"])["saved"])
        self.time += 86400
        self.assertEqual(self.outbox.maintain(self.feedback), [])
        self.assertFalse(self.outbox.rows)
        pending = self.envelope("answer", self.answer(request))
        self.outbox.enqueue(pending, self.time)
        self.time += 7 * 86400
        self.assertEqual(self.outbox.maintain(self.feedback)[0]["state"], "lost-capture")
        self.time += 22 * 86400
        self.feedback.maintain()
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_diagnostics").fetchone()[0], 0)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 1)
        self.time += 60 * 86400
        self.feedback.maintain()
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)
        result = self.feedback.submit(event, bound_session=self.sender, producer=self.outbox.producer)
        self.assertEqual(result["state"], "suppressed")
        self.assertFalse(result["saved"])
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")
        self.assertIsNotNone(self.store.get("checkpoints", self.cp))

    def test_deletion_restore_no_rating_resurrection_and_backup_retention(self):
        request = self.shown()
        event = self.envelope("answer", self.answer(request, quote="Erase this fixture phrase"))
        self.outbox.enqueue(event, self.time)
        self.assertTrue(self.outbox.collect(self.feedback, event["id"])["saved"])
        backup = Path(self.temp.name) / "snapshots" / "before.sqlite3"
        self.feedback.backup(backup)
        result = self.feedback.delete([event["id"]], actor="owner", outboxes=[self.outbox])
        self.assertEqual(result["residual_backup_seconds"], 7 * 86400)
        self.assertFalse(self.outbox.rows)
        self.assertNotIn(b"Erase this fixture phrase", self.path.read_bytes())
        restored_path = Path(self.temp.name) / "restored" / "store.sqlite3"
        self.feedback.restore(backup, restored_path)
        restored = base.c.Store(restored_path)
        service = Feedback(restored, clock=lambda: self.time, simulate=True)
        self.assertEqual(service.review(reviewer="owner", start=self.time - 1, end=self.time)["feedback"], [])
        self.assertEqual(service.submit(event, bound_session=self.sender, producer=self.outbox.producer)["state"], "suppressed")
        self.assertEqual(service.submit(self.envelope("claim", self.claim_payload()), bound_session=self.sender, producer="fresh")["state"], "omit")
        restored.close()
        self.time += 7 * 86400
        self.feedback.maintain()
        self.assertFalse(backup.exists())

    def test_restore_applies_expiry_and_missing_ledger_or_old_backup_refuses(self):
        request = self.shown()
        self.assertTrue(self.submit("answer", self.answer(request))["saved"])
        self.time += 89 * 86400
        backup = Path(self.temp.name) / "snapshots" / "late.sqlite3"
        self.feedback.backup(backup)
        self.time += 2 * 86400
        restored_path = Path(self.temp.name) / "restored" / "expired.sqlite3"
        self.feedback.restore(backup, restored_path)
        restored = base.c.Store(restored_path)
        self.assertEqual(restored.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)
        restored.close()
        self.time += 6 * 86400
        with self.assertRaises(FeedbackError):
            self.feedback.restore(backup, Path(self.temp.name) / "old" / "bad.sqlite3")

    def test_full_identity_purge_omits_old_work_even_after_restore(self):
        event = self.envelope("answer", self.answer(self.shown()))
        self.assertTrue(self.feedback.submit(event, bound_session=self.sender, producer="fixture")["saved"])
        backup = Path(self.temp.name) / "snapshots" / "before.sqlite3"
        self.feedback.backup(backup)
        self.feedback.delete([], actor="owner", full_identity_purge=True)
        self.assertEqual(self.submit("claim", self.claim_payload())["state"], "omit")
        target = Path(self.temp.name) / "restore" / "purged.sqlite3"
        self.feedback.restore(backup, target)
        restored = base.c.Store(target)
        self.assertEqual(restored.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)
        self.assertEqual(restored.db.execute("SELECT omit_all FROM feedback_control").fetchone()[0], 1)
        restored.close()
        self.feedback.delete([], actor="owner", purge_backups=True)
        self.assertFalse(backup.exists())

    def test_clock_rollback_omits_instead_of_bypassing_cooldown(self):
        self.submit("claim", self.claim_payload())
        self.time -= 1
        result = self.submit("claim", self.claim_payload())
        self.assertEqual(result["error"], "clock")
        self.assertFalse(result["saved"])

    def test_missing_current_ledger_refuses_restore_and_uningested_delete_suppresses(self):
        request = self.shown()
        event = self.envelope("answer", self.answer(request, quote="Pending before deletion"))
        self.feedback.delete([event["id"]], actor="owner")
        self.assertEqual(self.feedback.submit(event, bound_session=self.sender, producer="fixture")["state"], "suppressed")
        backup = Path(self.temp.name) / "snapshots" / "lineage.sqlite3"
        self.feedback.backup(backup)
        unrelated_path = Path(self.temp.name) / "unrelated" / "store.sqlite3"
        base.c.Store.initialize(unrelated_path)
        unrelated = base.c.Store(unrelated_path)
        try:
            with self.assertRaisesRegex(FeedbackError, "deletion ledger"):
                Feedback(unrelated, clock=lambda: self.time).restore(backup, Path(self.temp.name) / "restored" / "unsafe.sqlite3")
        finally:
            unrelated.close()

    def test_spontaneous_feedback_invalidates_undisplayed_claim(self):
        claim = self.claim_payload()
        self.assertEqual(self.submit("claim", claim)["state"], "claimed")
        payload = self.answer({}, rating=None, quote="Useful without another question")
        payload.update(outcome=self.outcome_id, thread=self.feedback_thread, checkpoint=self.cp)
        self.assertTrue(self.submit("spontaneous", payload)["saved"])
        self.assertEqual(self.submit("shown", {"request": claim["request"], "outcome": self.outcome_id})["error"], "transition")

    def test_post_snapshot_receipt_never_claims_missing_feedback_was_restored(self):
        claim = self.claim_payload()
        self.submit("claim", claim)
        backup = Path(self.temp.name) / "snapshots" / "before-answer.sqlite3"
        self.feedback.backup(backup)
        request = {"request": claim["request"], "outcome": self.outcome_id}
        self.submit("shown", request)
        event = self.envelope("answer", self.answer(request, quote="After snapshot"))
        self.assertTrue(self.feedback.submit(event, bound_session=self.sender, producer="fixture")["saved"])
        target = Path(self.temp.name) / "restore" / "older.sqlite3"
        self.feedback.restore(backup, target)
        restored = base.c.Store(target)
        try:
            service = Feedback(restored, clock=lambda: self.time, simulate=True)
            result = service.submit(event, bound_session=self.sender, producer="fixture")
            self.assertEqual(result["state"], "suppressed")
            self.assertFalse(result["saved"])
            self.assertEqual(service.submit(self.envelope("shown", request), bound_session=self.sender, producer="fixture")["error"], "transition")
            self.assertEqual(restored.db.execute("SELECT count(*) FROM feedback_content").fetchone()[0], 0)
        finally:
            restored.close()

    def test_bounded_review_does_not_expose_out_of_window_usage(self):
        review = self.feedback.review(reviewer="owner", start=self.time + 86400, end=self.time + 86401)
        self.assertEqual(review["coverage"]["participating_sessions"], [])
        self.assertEqual(review["coverage"]["registered_providers"], [])


def load_tests(loader, tests, pattern):
    # Reuse the fixture builder, not the base class's already-run acceptance tests.
    return unittest.TestSuite(FeedbackTest(name) for name in FeedbackTest.__dict__ if name.startswith("test_"))


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Inspectable C1 demo and inert producer contract. Temporary store only."""

import json
from pathlib import Path
import tempfile
from uuid import uuid4

from continuity import Store, now, render, render_outcomes


def identity():
    return str(uuid4())


class FixtureProducer:
    """No subprocesses, sockets, environment capture, provider calls or live IDs.

    C2 must replace this with independently verified adapters and a trusted bound
    outbox collector. The fixture manifest is deliberately not the role catalogue.
    """
    profiles = {"concierge": "fixture-intake", "worker": "fixture-worker"}

    def __init__(self, store):
        self.store, self.sequence = store, 0

    def emit(self, kind, subject, payload, session=None, producer="operator"):
        self.sequence += 1
        event = {"id": identity(), "sequence": self.sequence, "kind": kind,
                 "subject": subject, "payload": payload, "time": now()}
        result = self.store.apply(event, {"producer": "fixture:" + producer + ":" + str(session),
                                         "kind": "session" if session else producer, "session": session})
        if not result["ok"]:
            raise RuntimeError(result["error"])
        return result["value"]

    def session(self, role="worker", supported=True):
        session = identity()
        profile = self.profiles.get(role)
        if profile is None:
            raise ValueError("Role absent from inert fixture allowlist")
        self.emit("register", session, {"role": role, "environment": "inert-fixture",
                  "launch_attempt": identity(), "profile": profile,
                  "identity": {"provider": "fixture", "session_id": identity(),
                               "resume_ref": "fixture://context-only/not-executable", "evidence": "Synthetic identity"} if supported else None},
                  producer="launcher")
        return session

    def direct_entry(self):
        session = self.session()
        thread = identity()
        self.emit("open", thread, {"title": "Direct-entry fixture", "outcome": "Rediscover an evidenced decision",
                  "links": [], "coordinator": session}, session=session)
        return session, thread

    def observe(self, session, state):
        current = self.store.get("sessions", session)
        return self.emit("observe", session, {"expected_revision": current["revision"], "state": state,
                         "location": "fixture:tab:pane" if state == "available" else None,
                         "observed_at": now(), "source": "inert lifecycle callback"}, producer="observer")

    def launch_fixture(self, thread, role="worker", mode="create", session=None):
        if role not in self.profiles:
            raise ValueError("Unsupported fixture role; no request dispatched")
        request = self.emit("launch-request", identity(), {"thread": thread, "handoff": None,
                            "role": role, "profile": self.profiles[role], "mode": mode,
                            "session": session, "sources": [], "human_approval": "Fixture approval only"})
        return self.emit("launch-result", request["id"], {"expected_revision": 0,
                         "result": "unknown" if mode == "resume" else "refused",
                         "reason": "Inert C1: no live launch, resume or execution ownership check"}, producer="launcher")


def demo():
    # All stores are temporary; the sole durable output is what the caller chooses
    # to retain from stdout. No default XDG/live path and no installation.
    with tempfile.TemporaryDirectory(prefix="continuity-c1-") as temporary:
        path = Path(temporary) / "store" / "continuity.sqlite3"
        Store.initialize(path)
        store = Store(path)
        try:
            fixture = FixtureProducer(store)
            intake, receiver = fixture.session("concierge"), fixture.session()
            fixture.observe(receiver, "available")
            thread = identity()
            fixture.emit("open", thread, {"title": "An issue-free C1 discussion", "outcome": "Agree and inspect the offline continuity protocol",
                         "links": [], "coordinator": intake}, session=intake)
            h = fixture.emit("prepare", identity(), {"thread": thread, "expected_thread_revision": 0, "receiver": receiver,
                             "brief": {"ref": "fixture://brief", "outcome": "Inspect C1", "sources": [], "decisions": [],
                                       "scope": "Temporary records", "exclusions": "All live work", "next_action": "Read the fixture", "destination": "Inert receiver",
                                       "mode": "service", "exit_condition": "Return the bounded fixture result"},
                             "authority": "Fixture only", "expected_handoff_revision": 0}, session=intake)
            for kind, state, extra, actor in (
                ("send", 0, {"resolution": None}, intake),
                ("clarify", 1, {"questions": ["Is any live operation included?"]}, receiver),
                ("send", 2, {"resolution": {"answer": "No", "remaining_questions": [], "direct_discussion": False, "authority_resolved": True}}, intake),
            ):
                fixture.emit(kind, h["id"], {"revision": 1, "expected_state_revision": state, **extra}, session=actor)
            semantic = {"position": "Offline protocol accepted", "next_action": "Review the C1 evidence with André",
                        "decisions": ["No live execution"], "evidence": [], "questions": [], "blockers": []}
            fixture.emit("accept", h["id"], {"revision": 1, "expected_state_revision": 3,
                         "expected_thread_revision": 0, "previous_coordinator": intake,
                         "checkpoint_id": identity(), "content": semantic, "understanding": "Records and inert tests only"}, session=receiver)
            fixture.emit("checkpoint", identity(), {"thread": thread, "expected_revision": 1, "assignment_revision": 1,
                         "content": semantic, "disposition": "parked", "human_approval": "Fixture parking decision"}, session=receiver)
            print("C1 inert handoff / rediscovery fixture\n")
            print(render(store.query(thread)))
            direct, direct_thread = fixture.direct_entry()
            fixture.observe(direct, "exited")
            fixture.launch_fixture(direct_thread)
            print("\nDirect entry / abrupt exit fixture\n")
            print(render(store.query(direct_thread)))
            data = json.loads((Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "production-house.json").read_text())
            outcome = identity()
            fixture.emit("outcome-scope", outcome, {"expected_revision": 0, "title": "Production House — historical 2026-09-28 fixture",
                         "conditions": data["conditions"], "authority": [{"type": "fixture", "ref": "Agreed four-condition example"}],
                         "reason": "Dated fixture; no live fact verification or authorisation"}, session=intake)
            outcome_thread = identity()
            fixture.emit("open", outcome_thread, {"title": "Historical reconciliation", "outcome": "Inspect four independent completion paths",
                         "links": [], "coordinator": intake, "outcome_id": outcome}, session=intake)
            fixture.emit("checkpoint", identity(), {"thread": outcome_thread, "expected_revision": 0, "assignment_revision": 0,
                         "content": data["checkpoint"]}, session=intake)
            print("\nOutcome extension fixture\n")
            print(render_outcomes(store.outcome_view(outcome, "2026-09-28T12:00:00+00:00")))
        finally:
            store.close()


if __name__ == "__main__":
    demo()

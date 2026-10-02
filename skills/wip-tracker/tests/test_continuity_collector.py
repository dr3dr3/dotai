"""Real filesystem transport tests with inert contributors and temporary stores."""

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_continuity as base
from continuity_collector import Collector, binding_file, instructions


class CollectorTest(base.ContinuityTest):
    def setUp(self):
        super().setUp()
        self.channels = Path(self.temp.name) / "channels"
        self.channels.mkdir(mode=0o700)
        self.outbox, self.inbox = self.channels / "outbox", self.channels / "inbox"
        self.outbox.mkdir(mode=0o700)
        self.inbox.mkdir(mode=0o700)
        self.binding = {"version": 1, "session": self.sender, "producer": "bound:" + self.sender,
                        "outbox": str(self.outbox), "inbox": str(self.inbox),
                        "grants": [{"thread": self.thread, "assignment_revision": 0}]}
        self.collector = Collector(self.store, self.binding)

    def contribution(self):
        t = self.store.get("threads", self.thread)
        return self.event("checkpoint", base.uid(), {"thread": self.thread, "expected_revision": t["revision"],
                          "assignment_revision": t["assignment_revision"], "content": base.content()})

    def write(self, event, raw=None):
        path = self.outbox / (event["id"] + ".json")
        path.write_text(json.dumps(event) if raw is None else raw)
        path.chmod(0o600)
        return path

    def test_checkpoint_receipt_replay_and_restricted_instruction_payload(self):
        event = self.contribution()
        self.write(event)
        result = self.collector.collect()[0]
        self.assertEqual(result, {"event": event["id"], "committed": True, "ok": True, "code": "accepted"})
        self.assertEqual(json.loads((self.inbox / (event["id"] + ".json")).read_text()), result)
        self.assertEqual(self.collector.collect()[0], result)
        self.assertEqual(self.store.get("threads", self.thread)["revision"], 1)
        prompt = instructions(self.binding)
        self.assertIn("Feedback capture and feedback prompts remain disabled", prompt)
        self.assertNotIn(str(self.path), prompt)

    def test_collection_while_contributor_process_remains_open(self):
        handoff = self.sent()
        receiver = Collector(self.store, {**self.binding, "session": self.receiver,
                             "producer": "open-receiver",
                             "grants": [{"thread": self.thread, "assignment_revision": 0,
                                         "handoff": handoff["id"], "handoff_revision": 1}]})
        event = self.event("accept", handoff["id"], self.accept_payload(handoff))
        script = """
import json,os,sys
path=sys.argv[1]; event=json.loads(sys.stdin.readline())
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream: json.dump(event,stream)
print('ready',flush=True)
sys.stdin.readline()
"""
        process = subprocess.Popen([sys.executable, "-c", script, str(self.outbox / (event["id"] + ".json"))],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            process.stdin.write(json.dumps(event) + "\n")
            process.stdin.flush()
            self.assertEqual(process.stdout.readline().strip(), "ready")
            self.assertIsNone(process.poll())
            self.assertTrue(receiver.collect()[0]["ok"])
            self.assertEqual(self.store.get("handoffs", handoff["id"])["state"], "accepted")
            self.assertIsNone(process.poll())
        finally:
            process.stdin.write("finish\n")
            process.stdin.flush()
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()

    def test_spoofed_actor_and_ungranted_thread_rejected(self):
        event = self.contribution()
        event["actor"] = {"session": self.receiver}
        self.write(event)
        self.assertFalse(self.collector.collect()[0]["ok"])
        (self.outbox / (event["id"] + ".json")).unlink()
        other = self.open_thread()
        event = self.contribution()
        event["payload"]["thread"] = other
        self.write(event)
        self.assertEqual(self.collector.collect()[0]["code"], "forbidden")
        self.assertEqual(self.store.get("threads", other)["revision"], 0)

    def test_stale_assignment_and_exact_receiver_handoff(self):
        h = self.sent()
        receiver_binding = {**self.binding, "session": self.receiver, "producer": "receiver-channel",
                            "grants": [{"thread": self.thread, "assignment_revision": 0,
                                        "handoff": h["id"], "handoff_revision": 1}]}
        receiver = Collector(self.store, receiver_binding)
        event = self.event("accept", h["id"], self.accept_payload(h))
        path = self.write(event)
        self.assertTrue(receiver.collect()[0]["ok"])
        path.unlink()
        stale = self.contribution()
        path = self.write(stale)
        self.assertEqual(self.collector.collect()[0]["code"], "forbidden")
        path.unlink()
        fresh = self.contribution()
        self.write(fresh)
        self.assertTrue(receiver.collect()[0]["ok"])
        self.assertEqual(self.store.get("threads", self.thread)["revision"], 2)

    def test_bad_links_fifo_sizes_and_duplicate_json_keys(self):
        event = self.contribution()
        path = self.outbox / (event["id"] + ".json")
        outside = self.channels / "outside"
        outside.write_text(json.dumps(event))
        outside.chmod(0o600)
        for kind in ("symlink", "hardlink", "fifo", "oversized", "duplicate"):
            if kind == "symlink":
                path.symlink_to(outside)
            elif kind == "hardlink":
                os.link(outside, path)
            elif kind == "fifo":
                os.mkfifo(path, 0o600)
            elif kind == "oversized":
                self.write(event, " " * 65537)
            else:
                self.write(event, '{"id":"' + event["id"] + '","id":"duplicate"}')
            self.assertFalse(self.collector.collect()[0]["ok"], kind)
            path.unlink()
        self.assertEqual(self.store.get("threads", self.thread)["revision"], 0)

    def test_feedback_payload_never_reaches_general_journal(self):
        event = self.contribution()
        event["kind"] = "answer"
        event["payload"] = {"quote": "Must not enter general journal"}
        self.write(event)
        self.assertEqual(self.collector.collect()[0]["code"], "forbidden")
        self.assertIsNone(self.store.db.execute("SELECT 1 FROM events WHERE id=?", (event["id"],)).fetchone())

    def test_failed_ack_is_replayable_without_duplicate_checkpoint(self):
        event = self.contribution()
        self.write(event)
        with patch("continuity_collector.publish", side_effect=OSError("receipt disk unavailable")):
            with self.assertRaises(OSError):
                self.collector.collect()
        self.assertFalse(list(self.inbox.iterdir()))
        self.assertTrue(self.collector.collect()[0]["ok"])
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM checkpoints").fetchone()[0], 1)

    def test_owner_binding_path_and_channel_boundaries(self):
        path = self.channels / "binding.json"
        path.write_text(json.dumps(self.binding))
        path.chmod(0o600)
        self.assertEqual(binding_file(path), self.binding)
        path.chmod(0o644)
        with self.assertRaises(base.c.Error):
            binding_file(path)
        for change in ({"outbox": str(self.path.parent)}, {"inbox": str(self.outbox / "nested")},
                       {"outbox": str(self.channels / ".." / "escape")}):
            with self.assertRaises(base.c.Error):
                Collector(self.store, {**self.binding, **change})

    def test_batch_uses_producer_sequence_not_uuid_filename_order(self):
        first, second = self.contribution(), self.contribution()
        first["id"] = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        second["id"] = "00000000-0000-4000-8000-000000000000"
        second["payload"]["expected_revision"] = 1
        self.write(second)
        self.write(first)
        result = self.collector.collect()
        self.assertEqual([r["event"] for r in result], [first["id"], second["id"]])
        self.assertTrue(all(r["ok"] for r in result))
        self.assertEqual(self.store.get("threads", self.thread)["revision"], 2)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(CollectorTest(name) for name in CollectorTest.__dict__ if name.startswith("test_"))


if __name__ == "__main__":
    unittest.main()

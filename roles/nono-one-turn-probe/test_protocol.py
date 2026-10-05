"""Inert protocol acceptance tests; no Codex process or provider request."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("one_turn_protocol", Path(__file__).with_name("protocol.py"))
module = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class TurnContractTests(unittest.TestCase):
    def test_one_reviewed_turn_shape(self):
        request = module.turn_request("exact-thread", "reviewed-model")
        self.assertEqual(request["method"], "turn/start")
        self.assertEqual(request["params"]["threadId"], "exact-thread")
        self.assertEqual(request["params"]["model"], "reviewed-model")
        self.assertEqual(request["params"]["input"], [{"type": "text", "text": module.PROMPT}])
        self.assertEqual(request["params"]["approvalPolicy"], "never")
        self.assertNotIn("toolOutput", request["params"])

    def test_completion_requires_exact_ids_and_success(self):
        gate = module.TurnGate("thread-1", "turn-1")
        gate.observe({"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1", "item": {"type": "agentMessage"}}})
        gate.observe({"method": "item/agentMessage/delta", "params": {"threadId": "thread-1", "turnId": "turn-1", "delta": module.MARKER}})
        gate.observe({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}})
        gate.require_completed()
        with self.assertRaisesRegex(ValueError, "after turn completion"):
            gate.observe({"method": "turn/completed"})

    def test_unfinished_failed_or_mismatched_turn_is_not_accepted(self):
        for status in ("failed", "interrupted", "inProgress"):
            with self.subTest(status=status):
                gate = module.TurnGate("thread-1", "turn-1")
                with self.assertRaisesRegex(ValueError, "did not complete"):
                    gate.observe({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": status}}})
        with self.assertRaisesRegex(ValueError, "no successful"):
            module.TurnGate("thread-1", "turn-1").require_completed()
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            module.TurnGate("thread-1", "turn-1").observe({"method": "turn/completed", "params": {"threadId": "thread-2", "turn": {"id": "turn-1", "status": "completed"}}})

    def test_tool_item_and_server_request_fail_closed(self):
        gate = module.TurnGate("thread-1", "turn-1")
        with self.assertRaisesRegex(ValueError, "tool or unexpected item"):
            gate.observe({"method": "item/started", "params": {"threadId": "thread-1", "turnId": "turn-1", "item": {"type": "commandExecution"}}})
        with self.assertRaisesRegex(ValueError, "server request"):
            gate.observe({"id": 7, "method": "item/commandExecution/requestApproval", "params": {}})
        with self.assertRaisesRegex(ValueError, "unreviewed notification"):
            gate.observe({"method": "unknown/new-method", "params": {}})

    def test_completed_status_without_exact_reply_is_not_accepted(self):
        gate = module.TurnGate("thread-1", "turn-1")
        gate.observe({"method": "item/agentMessage/delta", "params": {"threadId": "thread-1", "turnId": "turn-1", "delta": "something else"}})
        with self.assertRaisesRegex(ValueError, "did not match marker"):
            gate.observe({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "status": "completed"}}})


if __name__ == "__main__":
    unittest.main()

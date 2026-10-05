"""Offline contract for a proposed single Codex app-server turn.

This module has no process, network, credential or Docker entry point. It is a
reviewable protocol component for a separately authorised captain-run fixture.
"""

from dataclasses import dataclass


MARKER = "ROE_PERSISTENCE_PROBE_OK"
PROMPT = (
    "This is a synthetic session-persistence check. Reply with exactly "
    f"{MARKER}. Do not use tools, inspect files, or take any other action."
)
ALLOWED_ITEM_TYPES = frozenset({"userMessage", "agentMessage", "reasoning"})


def turn_request(thread_id: str, model: str) -> dict:
    """Build the one permitted inference request for pinned Codex 0.157.0."""
    if not thread_id or not model or not isinstance(thread_id, str) or not isinstance(model, str):
        raise ValueError("verified thread ID and reviewed model are required")
    return {
        "method": "turn/start",
        "params": {
            "threadId": thread_id,
            "input": [{"type": "text", "text": PROMPT}],
            "model": model,
            "approvalPolicy": "never",
        },
    }


@dataclass
class TurnGate:
    """Accept only one completed turn with no observed tool/server request."""

    thread_id: str
    turn_id: str
    completed: bool = False
    reply: str = ""

    def observe(self, message: dict) -> None:
        if self.completed:
            raise ValueError("event after turn completion")
        if not isinstance(message, dict):
            raise ValueError("invalid protocol message")
        method = message.get("method")
        if "id" in message and method is not None:
            raise ValueError("server request requires action; stop without answering")
        if method in ("item/started", "item/completed"):
            params = message.get("params") or {}
            if params.get("threadId") != self.thread_id or params.get("turnId") != self.turn_id:
                raise ValueError("item identity mismatch")
            item_type = (params.get("item") or {}).get("type")
            if item_type not in ALLOWED_ITEM_TYPES:
                raise ValueError("tool or unexpected item observed; trial failed")
        elif method == "turn/completed":
            params = message.get("params") or {}
            turn = params.get("turn") or {}
            if params.get("threadId") != self.thread_id or turn.get("id") != self.turn_id:
                raise ValueError("turn identity mismatch")
            if turn.get("status") != "completed":
                raise ValueError("turn did not complete successfully")
            if self.reply.strip() != MARKER:
                raise ValueError("synthetic reply did not match marker")
            self.completed = True
        elif method == "item/agentMessage/delta":
            params = message.get("params") or {}
            if params.get("threadId") != self.thread_id or params.get("turnId") != self.turn_id:
                raise ValueError("notification identity mismatch")
            delta = params.get("delta")
            if not isinstance(delta, str) or len(self.reply) + len(delta) > 512:
                raise ValueError("synthetic reply is invalid or too long")
            self.reply += delta
        elif method in ("turn/started", "item/reasoning/delta"):
            params = message.get("params") or {}
            if params.get("threadId") != self.thread_id or params.get("turnId") != self.turn_id:
                raise ValueError("notification identity mismatch")
        elif method is not None:
            raise ValueError("unreviewed notification; stop")

    def require_completed(self) -> None:
        if not self.completed:
            raise ValueError("no successful turn completion")

#!/usr/bin/env node
/** Offline protocol fake; never makes a model or network call. */
import { createInterface } from "node:readline";

if (process.env.ROE_FAKE_SECRET_CANARY) {
  process.stderr.write("HOST_ENV_LEAKED\n");
  process.exit(2);
}
const emit = (message: object) => process.stdout.write(JSON.stringify(message) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown> };
  if (message.method === "initialize") emit({ id: 1, result: { userAgent: "fake" } });
  if (message.method === "thread/start") emit({ id: 2, result: { thread: { id: "offline-thread" } } });
  if (message.method === "turn/start") {
    const prompt = (message.params?.input as Array<{ text: string }>)[0].text;
    const marker = prompt.match(/ROE_PILOT_[A-Z0-9_]+/)?.[0] ?? "";
    const scenario = marker.replace("ROE_PILOT_OFFLINE_", "").toLowerCase().replaceAll("_", "-");
    emit({ id: 3, result: { turn: { id: "offline-turn" } } });
    if (scenario === "tool") emit({ method: "item/started", params: { threadId: "offline-thread", turnId: "offline-turn", item: { type: "commandExecution", id: "tool" } } });
    if (scenario === "complete" || scenario === "wrong-answer") {
      emit({ method: "item/completed", params: { threadId: "offline-thread", turnId: "offline-turn", item: { type: "agentMessage", id: "answer", text: scenario === "complete" ? marker : "wrong" } } });
    }
    if (scenario !== "tool") emit({ method: "turn/completed", params: { threadId: "offline-thread", turn: { id: "offline-turn", status: scenario === "failed" ? "failed" : "completed" } } });
  }
}

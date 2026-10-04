#!/usr/bin/env node
/** One bounded Codex app-server turn. Never print protocol payloads or secrets. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type Message = { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown };
type Reply = Record<string, unknown>;

export async function runClient(
  server: string,
  model: string,
  marker: string,
  timeoutMs = 65000,
  serverArgs = ["app-server", "--listen", "stdio://"],
  extraEnv: Record<string, string> = {},
): Promise<void> {
  assert.match(server, /^\//);
  assert.ok(serverArgs.length > 0 && serverArgs.every((arg) => typeof arg === "string" && !arg.includes("\u0000")));
  assert.match(model, /^[a-zA-Z0-9._-]{1,80}$/);
  assert.match(marker, /^ROE_PILOT_[A-Z0-9_]{1,48}$/);
  assert.ok(timeoutMs > 0 && timeoutMs <= 65000);

  const allowed = [
    "PATH", "HOME", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
    "TMPDIR", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
    "https_proxy", "http_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE",
    "ROE_PILOT_PROVIDER_TOKEN",
  ];
  const environment = Object.fromEntries(allowed.flatMap((key) => {
    const value = process.env[key];
    return value === undefined ? [] : [[key, value]];
  }));

  const child = spawn(server, serverArgs, {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...environment, ...extraEnv },
  });
  child.on("error", () => { /* the exit assertion reports a refused launch */ });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let phase: "initialize" | "thread" | "turn" | "complete" = "initialize";
  let threadId = "";
  let turnId = "";
  let answer = "";
  let lines = 0;
  let finished = false;
  const write = (value: object) => child.stdin.write(JSON.stringify(value) + "\n");
  const stop = (reason: string): never => {
    child.kill("SIGKILL");
    throw new Error(reason);
  };
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    write({ id: 1, method: "initialize", params: { clientInfo: { name: "roe_bounded_provider_fixture", version: "1" } } });
    for await (const line of createInterface({ input: child.stdout })) {
      if (++lines > 500 || line.length > 262144) stop("protocol output limit exceeded");
      let message: Message;
      try { message = JSON.parse(line) as Message; }
      catch { stop("invalid app-server JSON"); }
      if (message.id !== undefined && message.method) stop("unexpected server request");
      if (message.error) stop("app-server returned an error");
      if (phase === "initialize" && message.id === 1) {
        assert.ok(message.result && typeof message.result === "object", "initialize response missing");
        write({ method: "initialized" });
        write({ id: 2, method: "thread/start", params: {
          cwd: "/state/pilot/work", ephemeral: false, model,
          modelProvider: "roe_pilot_openai", approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: "Answer the user's exact marker only. Do not use tools, read files, or run commands.",
        } });
        phase = "thread";
      } else if (phase === "thread" && message.id === 2) {
        const result = message.result as Reply | undefined;
        const thread = result?.thread as Reply | undefined;
        assert.equal(typeof thread?.id, "string", "thread id missing");
        threadId = thread.id as string;
        write({ id: 3, method: "turn/start", params: {
          threadId, input: [{ type: "text", text: `Reply with exactly ${marker}. Do not use tools.` }],
          approvalPolicy: "never", sandboxPolicy: { type: "readOnly", networkAccess: false },
        } });
        phase = "turn";
      } else if (phase === "turn" && message.id === 3) {
        const result = message.result as Reply | undefined;
        const turn = result?.turn as Reply | undefined;
        assert.equal(typeof turn?.id, "string", "turn id missing");
        turnId = turn.id as string;
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const params = message.params as Reply | undefined;
        const item = params?.item as Reply | undefined;
        if (item?.type !== "agentMessage" && item?.type !== "userMessage" && item?.type !== "reasoning")
          stop("unexpected tool or item activity");
        if (message.method === "item/completed" && item?.type === "agentMessage") {
          if (answer) stop("multiple agent messages");
          answer = item.text as string;
        }
      } else if (message.method === "turn/completed") {
        const params = message.params as Reply | undefined;
        const turn = params?.turn as Reply | undefined;
        assert.equal(params?.threadId, threadId, "thread mismatch");
        assert.equal(turn?.id, turnId, "turn mismatch");
        assert.equal(turn?.status, "completed", "turn did not complete");
        assert.equal(answer, marker, "unexpected model answer");
        phase = "complete";
        finished = true;
        child.stdin.end();
      }
    }
    const exitCode = await closed;
    assert.equal(exitCode, 0, "app-server exit failed");
    assert.ok(finished && phase === "complete", "no completed turn");
    process.stdout.write("CODEX_PROVIDER_TURN_OK\n");
  } finally {
    clearTimeout(timer);
    if (!child.killed && !finished) child.kill("SIGKILL");
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [server, model, marker] = process.argv.slice(2);
  runClient(server, model, marker).catch((error) => {
    process.stderr.write(`CODEX_PROVIDER_TURN_REFUSED ${error instanceof Error ? error.message : "unknown"}\n`);
    process.exitCode = 1;
  });
}

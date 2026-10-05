#!/usr/bin/env node
/** Credential-free, process-separated fixture for the existing continuity store. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const STORE_CLI = resolve(HERE, "../../skills/wip-tracker/scripts/continuity.py");
const PYTHON = "/usr/bin/python3";
const SESSION = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";
const CHECKPOINT = "44444444-4444-4444-8444-444444444444";
const TIME = "2026-10-03T00:00:00+00:00";
const CONTENT = {
  position: "Synthetic checkpoint saved; no provider conversation exists",
  decisions: ["Keep advisory role activation disabled"],
  evidence: [{ type: "fixture", ref: "checkpoint-process-reload" }],
  questions: ["How will authenticated native transcript resume be accepted?"],
  blockers: ["Provider session identity is unverified"],
  next_action: "Run separate provider and safe-restore acceptance gates",
};

function environment(root: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/bin:/bin", HOME: root, LANG: "C", ROE_CHECKPOINT_FIXTURE: "1" };
}

function storePath(root: string): string {
  assert.equal(lstatSync(root).mode & 0o777, 0o700, "fixture root must be private");
  assert.equal(lstatSync(root).isSymbolicLink(), false, "fixture root must not be a symlink");
  return join(root, "store", "continuity.sqlite3");
}

function cli(root: string, command: string[], input?: unknown): unknown {
  const result = spawnSync(PYTHON, [STORE_CLI, "--db", storePath(root), ...command], {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    env: environment(root),
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
  assert.equal(result.error, undefined, "continuity CLI failed to start");
  assert.equal(result.status, 0, `continuity CLI ${command[0]} failed: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function event(id: string, kind: string, subject: string, payload: unknown): object {
  return { id, sequence: 1, kind, subject, time: TIME, payload };
}

function apply(root: string, actor: string[], data: object): void {
  const result = cli(root, ["apply", ...actor], data) as { ok: boolean; error?: unknown };
  assert.equal(result.ok, true, `event rejected: ${JSON.stringify(result.error)}`);
}

function write(root: string): void {
  assert.deepEqual(cli(root, ["init"]), { ok: true, schema_version: 2 });
  apply(root, ["--producer", "fixture-launcher", "--kind", "launcher"],
    event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "register", SESSION,
      { role: "fixture-advisor", environment: "offline-fixture", launch_attempt: ATTEMPT,
        profile: "no-launch", identity: null }));
  apply(root, ["--producer", "fixture-operator", "--kind", "operator"],
    event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "open", THREAD,
      { title: "Credential-free checkpoint fixture", outcome: "Recover exact semantic position",
        links: [], coordinator: SESSION }));
  apply(root, ["--producer", "fixture-session", "--kind", "session", "--session", SESSION],
    event("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "checkpoint", CHECKPOINT,
      { thread: THREAD, expected_revision: 0, assignment_revision: 0, content: CONTENT }));
  const db = lstatSync(storePath(root));
  assert.equal(db.mode & 0o777, 0o600, "continuity database must be private");
  assert.equal(db.isSymbolicLink(), false, "continuity database must not be a symlink");
  process.stdout.write("writer committed synthetic checkpoint and exited\n");
}

function read(root: string): void {
  const rows = cli(root, ["query", "--thread", THREAD]) as Array<{
    thread: { id: string; checkpoint: string; coordinator: string; revision: number };
    checkpoint: { id: string; thread: string; author: string; assignment_revision: number; content: unknown };
    destination: { identity: unknown };
    runtime_authority: string;
  }>;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.thread.id, THREAD);
  assert.equal(row.thread.coordinator, SESSION);
  assert.equal(row.thread.checkpoint, CHECKPOINT);
  assert.equal(row.thread.revision, 1);
  assert.equal(row.checkpoint.id, CHECKPOINT);
  assert.equal(row.checkpoint.thread, THREAD);
  assert.equal(row.checkpoint.author, SESSION);
  assert.equal(row.checkpoint.assignment_revision, 0);
  assert.deepEqual(row.checkpoint.content, CONTENT);
  assert.equal(row.destination.identity, null, "fixture must have no provider identity");
  assert.equal(row.runtime_authority, "unchanged");
  process.stdout.write("reader recovered exact checkpoint without provider identity\n");
}

function child(mode: "write" | "read", root: string): void {
  const result = spawnSync(process.execPath, [SELF, mode, root], {
    encoding: "utf8", env: environment(root), maxBuffer: 1024 * 1024, timeout: 15000,
  });
  assert.equal(result.error, undefined, `${mode} process failed to start`);
  assert.equal(result.status, 0, `${mode} process failed: ${result.stdout} ${result.stderr}`);
  process.stdout.write(result.stdout);
}

function main(): void {
  const mode = process.argv[2];
  if (mode === "write" || mode === "read") {
    assert.equal(process.argv.length, 4, "exact fixture root required");
    const root = process.argv[3];
    assert.equal(resolve(root), root, "absolute fixture root required");
    assert.equal(process.env.ROE_CHECKPOINT_FIXTURE, "1", "fixture child invocation required");
    assert.ok(root.startsWith(join(tmpdir(), "roe-checkpoint-probe-")), "temporary fixture root required");
    (mode === "write" ? write : read)(root);
    return;
  }
  assert.equal(mode, undefined, "use no arguments for the bounded fixture");
  const root = mkdtempSync(join(tmpdir(), "roe-checkpoint-probe-"));
  chmodSync(root, 0o700);
  try {
    child("write", root);
    child("read", root);
    process.stdout.write("PASS: credential-free checkpoint persisted across processes\n");
  } finally {
    rmSync(root, { recursive: true, force: false });
  }
}

main();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const CLI = new URL("../scripts/continuity_cli.ts", import.meta.url).pathname;
const SESSION = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";
const CHECKPOINT = "44444444-4444-4444-8444-444444444444";
const TIME = "2026-10-03T00:00:00Z";
const CONTENT = {
  position:
    "Synthetic TypeScript checkpoint saved; no provider conversation exists",
  decisions: ["Keep advisory role activation disabled"],
  evidence: [{ type: "fixture", ref: "typescript-checkpoint-process" }],
  questions: ["How will authenticated native transcript resume be accepted?"],
  blockers: ["Provider session identity is unverified"],
  next_action: "Run separate provider and safe-restore acceptance gates",
};

function event(
  id: string,
  kind: string,
  subject: string,
  payload: object,
): object {
  return { id, sequence: 1, kind, subject, time: TIME, payload };
}

function invoke(db: string, args: string[], input?: object): unknown {
  const result = spawnSync(
    process.execPath,
    [CLI, args[0], "--db", db, ...args.slice(1)],
    {
      encoding: "utf8",
      input: input === undefined ? undefined : JSON.stringify(input),
      timeout: 10000,
      env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C" },
    },
  );
  assert.equal(result.error, undefined, `CLI failed to start: ${args[0]}`);
  assert.equal(
    result.status,
    0,
    `CLI ${args[0]} failed: ${result.stdout} ${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

test("synthetic checkpoint survives separate TypeScript CLI processes", () => {
  const directory = mkdtempSync(join(tmpdir(), "roe-checkpoint-ts-process-"));
  chmodSync(directory, 0o700);
  const db = join(directory, "continuity.sqlite3");
  try {
    assert.deepEqual(invoke(db, ["init"]), { ok: true, schema_version: 2 });
    assert.equal(
      (
        invoke(
          db,
          ["apply", "--producer", "fixture-launcher", "--kind", "launcher"],
          event("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "register", SESSION, {
            role: "fixture-advisor",
            environment: "offline-ts-process-fixture",
            launch_attempt: "22222222-2222-4222-8222-222222222222",
            profile: "no-launch",
            identity: null,
          }),
        ) as { ok: boolean }
      ).ok,
      true,
    );
    assert.equal(
      (
        invoke(
          db,
          ["apply", "--producer", "fixture-operator", "--kind", "operator"],
          event("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "open", THREAD, {
            title: "TypeScript process checkpoint fixture",
            outcome: "Recover exact semantic position",
            links: [],
            coordinator: SESSION,
          }),
        ) as { ok: boolean }
      ).ok,
      true,
    );
    assert.equal(
      (
        invoke(
          db,
          [
            "apply",
            "--producer",
            "fixture-session",
            "--kind",
            "session",
            "--session",
            SESSION,
          ],
          event(
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "checkpoint",
            CHECKPOINT,
            {
              thread: THREAD,
              expected_revision: 0,
              assignment_revision: 0,
              content: CONTENT,
            },
          ),
        ) as { ok: boolean }
      ).ok,
      true,
    );
    assert.equal(statSync(db).mode & 0o777, 0o600);

    // Every invoke starts and exits a separate Node process; this final one
    // must reload the committed SQLite record from disk.
    const rows = invoke(db, ["query", "--thread", THREAD]) as Array<{
      thread: {
        id: string;
        checkpoint: string;
        coordinator: string;
        revision: number;
      };
      checkpoint: {
        id: string;
        thread: string;
        author: string;
        assignment_revision: number;
        content: unknown;
      };
      destination: { identity: unknown };
      runtime_authority: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].thread.id, THREAD);
    assert.equal(rows[0].thread.checkpoint, CHECKPOINT);
    assert.equal(rows[0].thread.coordinator, SESSION);
    assert.equal(rows[0].thread.revision, 1);
    assert.equal(rows[0].checkpoint.id, CHECKPOINT);
    assert.equal(rows[0].checkpoint.thread, THREAD);
    assert.equal(rows[0].checkpoint.author, SESSION);
    assert.equal(rows[0].checkpoint.assignment_revision, 0);
    assert.deepEqual(rows[0].checkpoint.content, CONTENT);
    assert.equal(rows[0].destination.identity, null);
    assert.equal(rows[0].runtime_authority, "unchanged");
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
});

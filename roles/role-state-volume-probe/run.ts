#!/usr/bin/env node
/** Two operator runs test a private role volume across separate reservations. */
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bundle,
  plan,
  runContainer,
  verifyPins as verifyCheckpointPins,
  type Call,
  type Plan,
} from "../checkpoint-ts-container-probe/run.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI = resolve(HERE, "../..");
const SOURCE_COMMIT = "b3d9cf811b9770e9fde03a50b9ec1a888a6c4142";
const VOLUME = "roe-role-pilot-state-fixture-v1";
const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const BUNDLE_SHA256 =
  "41cd568fe9d255cf5f2dd3eb899fba38bf169ddcb05c9eb0bf08e8d9ac2afb51";
const LABELS = {
  "net.rockofeye.purpose": "role-state-acceptance-fixture",
  "net.rockofeye.role": "pilot",
  "net.rockofeye.contract": "typescript-checkpoint-v1",
};

export type Result = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function systemCall(argv: string[], input?: Buffer, timeoutMs = 60000): Result {
  const result = spawnSync(argv[0], argv.slice(1), {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      LANG: "C",
      ROE_RUNTIME_TOKEN: process.env.ROE_RUNTIME_TOKEN,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyInputs(): void {
  verifyCheckpointPins();
  assert.equal(
    execFileSync("git", ["-C", DOTAI, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    SOURCE_COMMIT,
  );
  const pins = JSON.parse(
    readFileSync(join(HERE, "pins.json"), "utf8"),
  ) as Record<string, string>;
  assert.deepEqual(Object.keys(pins), [fileURLToPath(import.meta.url)]);
  assert.equal(
    sha256(fileURLToPath(import.meta.url)),
    pins[fileURLToPath(import.meta.url)],
  );
}

export function rolePlan(suffix: string): Plan {
  const candidate = plan(suffix);
  const mount = `type=volume,src=${VOLUME},dst=/state,volume-nocopy`;
  const readerMount = mount + ",readonly";
  const containers = Object.fromEntries(
    Object.entries(candidate.containers).map(([phase, item]) => [
      phase,
      {
        name: item.name.replace("roe-checkpoint-ts-", "roe-role-state-"),
        command: item.command.map((part) =>
          part === candidate.mount
            ? mount
            : part === candidate.reader_mount
              ? readerMount
              : part === item.name
                ? item.name.replace("roe-checkpoint-ts-", "roe-role-state-")
                : part,
        ),
      },
    ]),
  );
  return { volume: VOLUME, mount, reader_mount: readerMount, containers };
}

function mustSucceed(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} failed to start`);
  assert.equal(
    result.status,
    0,
    `${label} failed: ${result.stdout} ${result.stderr}`,
  );
  return result.stdout.trim();
}

export function checkVolumeInspection(result: Result): void {
  const record = JSON.parse(mustSucceed(result, "volume inspect")) as {
    Name?: unknown;
    Driver?: unknown;
    Scope?: unknown;
    Labels?: unknown;
    Options?: unknown;
  };
  assert.equal(record.Name, VOLUME, "unexpected role volume");
  assert.equal(record.Driver, "local", "unexpected volume driver");
  assert.equal(record.Scope, "local", "unexpected volume scope");
  assert.deepEqual(record.Labels, LABELS, "role volume labels changed");
  assert.ok(
    record.Options === null ||
      (typeof record.Options === "object" &&
        record.Options !== null &&
        !Array.isArray(record.Options) &&
        Object.keys(record.Options).length === 0),
    "volume driver options are not allowed",
  );
}

function verifyCheckpoint(output: string): void {
  const line = output
    .split("\n")
    .find((value) => value.startsWith("CHECKPOINT_JSON="));
  assert.ok(line, "fresh reader did not return checkpoint JSON");
  const rows = JSON.parse(line.slice("CHECKPOINT_JSON=".length)) as Array<{
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
  const row = rows[0];
  assert.equal(row.thread.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(row.thread.checkpoint, "44444444-4444-4444-8444-444444444444");
  assert.equal(row.thread.coordinator, "11111111-1111-4111-8111-111111111111");
  assert.equal(row.thread.revision, 1);
  assert.equal(row.checkpoint.id, row.thread.checkpoint);
  assert.equal(row.checkpoint.thread, row.thread.id);
  assert.equal(row.checkpoint.author, row.thread.coordinator);
  assert.equal(row.checkpoint.assignment_revision, 0);
  assert.deepEqual(row.checkpoint.content, {
    position:
      "Synthetic TypeScript checkpoint saved; no provider conversation exists",
    decisions: ["Keep advisory role activation disabled"],
    evidence: [{ type: "fixture", ref: "typescript-checkpoint-process" }],
    questions: ["How will authenticated native transcript resume be accepted?"],
    blockers: ["Provider session identity is unverified"],
    next_action: "Run separate provider and safe-restore acceptance gates",
  });
  assert.equal(row.destination.identity, null);
  assert.equal(row.runtime_authority, "unchanged");
}

export function main(
  argv = process.argv.slice(2),
  call: Call = systemCall,
): number {
  assert.ok(
    argv.length <= 1 &&
      (argv.length === 0 ||
        ["--offline", "--install", "--verify"].includes(argv[0])),
    "choose no arguments, --offline, --install or --verify",
  );
  verifyInputs();
  const mode = argv[0] ?? "plan";
  const planned = rolePlan(
    mode === "plan" || mode === "--offline"
      ? "000000000000"
      : randomUUID().replaceAll("-", "").slice(0, 12),
  );
  process.stdout.write(
    JSON.stringify({
      mode,
      volume: planned.volume,
      labels: LABELS,
      image: IMAGE,
      engine: ENGINE,
      mount: planned.mount,
      reader_mount: planned.reader_mount,
      containers: planned.containers,
      no_host_mounts: true,
      no_credentials_or_model_calls: true,
    }) + "\n",
  );
  if (mode === "plan") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-role-state-volume-"));
  try {
    const payload = bundle(directory);
    const digest = createHash("sha256").update(payload).digest("hex");
    assert.equal(digest, BUNDLE_SHA256, "reviewed payload changed");
    process.stdout.write(
      `BUNDLE_VERIFIED bytes=${payload.length} sha256=${digest}\n`,
    );
    if (mode === "--offline") return 0;
    assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
    const server = JSON.parse(
      mustSucceed(
        call(
          ["docker", "version", "--format", "{{json .Server}}"],
          undefined,
          15000,
        ),
        "engine check",
      ),
    ) as typeof ENGINE;
    for (const [key, value] of Object.entries(ENGINE))
      assert.equal(
        server[key as keyof typeof ENGINE],
        value,
        `engine ${key} changed`,
      );
    if (mode === "--install") {
      const before = call(
        ["docker", "volume", "ls", "--quiet", "--filter", `name=^${VOLUME}$`],
        undefined,
        15000,
      );
      assert.equal(
        mustSucceed(before, "volume absence check"),
        "",
        "candidate volume already exists",
      );
      const create = ["docker", "volume", "create"];
      for (const [key, value] of Object.entries(LABELS))
        create.push("--label", `${key}=${value}`);
      create.push(VOLUME);
      assert.equal(
        mustSucceed(call(create, undefined, 15000), "volume create"),
        VOLUME,
      );
      process.stdout.write(
        `VOLUME_CREATED ${VOLUME}; retain for separate verification\n`,
      );
      checkVolumeInspection(
        call(
          ["docker", "volume", "inspect", "--format", "{{json .}}", VOLUME],
          undefined,
          15000,
        ),
      );
      for (const phase of ["init", "writer", "seal"]) {
        const result = runContainer(
          phase,
          planned.containers[phase],
          join(directory, `${phase}.cid`),
          call,
          phase === "writer" ? payload : undefined,
        );
        assert.ok(result.ok, `${phase} failed; retain volume and reservation`);
        if (phase === "writer")
          assert.ok(
            result.output.includes(
              "PASS: TypeScript checkpoint committed in private role directory",
            ),
          );
      }
      process.stdout.write(
        `PASS: role-specific synthetic volume ${VOLUME} sealed for a fresh operator run\n`,
      );
      return 0;
    }
    checkVolumeInspection(
      call(
        ["docker", "volume", "inspect", "--format", "{{json .}}", VOLUME],
        undefined,
        15000,
      ),
    );
    const result = runContainer(
      "reader",
      planned.containers.reader,
      join(directory, "reader.cid"),
      call,
      payload,
    );
    assert.ok(result.ok, "reader failed; retain volume and reservation");
    verifyCheckpoint(result.output);
    assert.equal(
      mustSucceed(
        call(["docker", "volume", "rm", VOLUME], undefined, 15000),
        "volume removal",
      ),
      VOLUME,
    );
    const after = call(
      ["docker", "volume", "ls", "--quiet", "--filter", `name=^${VOLUME}$`],
      undefined,
      15000,
    );
    assert.equal(
      mustSucceed(after, "volume absence check"),
      "",
      "synthetic volume remains",
    );
    process.stdout.write(
      `PASS: TypeScript checkpoint survived separate reservation; exact volume ${VOLUME} removed\n`,
    );
    return 0;
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stdout.write(
      `STOP: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

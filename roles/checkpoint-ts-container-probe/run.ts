#!/usr/bin/env node
/** Plan-only by default. Merged TypeScript checkpoint across fresh containers. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI = resolve(HERE, "../..");
const SOURCE_COMMIT = "b3d9cf811b9770e9fde03a50b9ec1a888a6c4142";
const BUNDLE_SHA256 =
  "41cd568fe9d255cf5f2dd3eb899fba38bf169ddcb05c9eb0bf08e8d9ac2afb51";
const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const ROLE = "pilot";
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

type Result = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};
export type Call = (
  argv: string[],
  input?: Buffer,
  timeoutMs?: number,
) => Result;

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

export function inputs(): Record<string, string> {
  const mapped = JSON.parse(
    readFileSync(join(HERE, "bundle.json"), "utf8"),
  ) as Record<string, string>;
  return Object.fromEntries(
    [
      fileURLToPath(import.meta.url),
      join(HERE, "bundle.json"),
      ...Object.values(mapped),
    ].map((path) => [path, "pinned input"]),
  );
}

export function verifyPins(): void {
  assert.equal(
    execFileSync("git", ["-C", DOTAI, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    SOURCE_COMMIT,
    "merged TypeScript source revision changed",
  );
  const pins = JSON.parse(
    readFileSync(join(HERE, "pins.json"), "utf8"),
  ) as Record<string, string>;
  assert.deepEqual(
    Object.keys(pins).sort(),
    Object.keys(inputs()).sort(),
    "pin input set changed",
  );
  for (const path of Object.keys(inputs())) {
    assert.equal(sha256(path), pins[path], `pinned input changed: ${path}`);
  }
}

function fixtureEvent(
  id: string,
  kind: string,
  subject: string,
  payload: object,
): object {
  return { id, sequence: 1, kind, subject, time: TIME, payload };
}

function fixtureFiles(): Record<string, string> {
  const events = {
    "register.json": fixtureEvent(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "register",
      SESSION,
      {
        role: "fixture-advisor",
        environment: "offline-ts-container-fixture",
        launch_attempt: "22222222-2222-4222-8222-222222222222",
        profile: "no-launch",
        identity: null,
      },
    ),
    "open.json": fixtureEvent(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "open",
      THREAD,
      {
        title: "TypeScript container checkpoint fixture",
        outcome: "Recover exact semantic position",
        links: [],
        coordinator: SESSION,
      },
    ),
    "checkpoint.json": fixtureEvent(
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
  };
  return Object.fromEntries(
    Object.entries(events).map(([name, value]) => [
      name,
      JSON.stringify(value) + "\n",
    ]),
  );
}

function validateEventsOffline(
  directory: string,
  stage: string,
  files: Record<string, string>,
): void {
  const offline = join(directory, "offline");
  mkdirSync(offline, { mode: 0o700 });
  const db = join(offline, "continuity.sqlite3");
  const loader = join(stage, "lib/ld-linux-aarch64.so.1");
  const node = join(stage, "node");
  const cli = join(stage, "continuity_cli.ts");
  const invoke = (args: string[], input?: string) => {
    const output = execFileSync(
      loader,
      [
        "--library-path",
        join(stage, "lib"),
        node,
        cli,
        args[0],
        "--db",
        db,
        ...args.slice(1),
      ],
      {
        encoding: "utf8",
        input,
        timeout: 10000,
        env: { PATH: "/usr/bin:/bin", HOME: offline, LANG: "C" },
      },
    );
    return JSON.parse(output);
  };
  assert.deepEqual(invoke(["init"]), { ok: true, schema_version: 2 });
  for (const [name, actor] of [
    ["register.json", ["--producer", "fixture-launcher", "--kind", "launcher"]],
    ["open.json", ["--producer", "fixture-operator", "--kind", "operator"]],
    [
      "checkpoint.json",
      [
        "--producer",
        "fixture-session",
        "--kind",
        "session",
        "--session",
        SESSION,
      ],
    ],
  ] as Array<[string, string[]]>) {
    const result = invoke(["apply", ...actor], files[name]);
    assert.equal(
      result.ok,
      true,
      `synthetic ${name} event rejected: ${JSON.stringify(result)}`,
    );
  }
  verifyCheckpoint(
    "CHECKPOINT_JSON=" +
      JSON.stringify(invoke(["query", "--thread", THREAD])) +
      "\n",
  );
}

export type Plan = {
  volume: string;
  mount: string;
  reader_mount: string;
  containers: Record<string, { name: string; command: string[] }>;
};

export function plan(suffix: string): Plan {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  const volume = `roe-role-${ROLE}-checkpoint-ts-fixture-${suffix}`;
  const mount = `type=volume,src=${volume},dst=/state,volume-nocopy`;
  const readerMount = mount + ",readonly";
  const base = [
    "docker",
    "run",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--memory=768m",
    "--memory-swap=768m",
    "--cpus=1",
    "--pids-limit=64",
  ];
  const make = (
    phase: string,
    user: string,
    shell: string,
    payload: boolean,
  ) => {
    const name = `roe-checkpoint-ts-${phase}-${suffix}`;
    const command = [
      ...base,
      "--mount",
      phase === "reader" ? readerMount : mount,
      "--name",
      name,
      `--user=${user}`,
      ...(payload
        ? [
            "--tmpfs",
            "/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777",
            "--interactive",
          ]
        : []),
      "--entrypoint",
      "/usr/bin/timeout",
      IMAGE,
      "--signal=TERM",
      "--kill-after=5s",
      "75s",
      "/bin/sh",
      "-c",
      shell,
    ];
    return { name, command };
  };
  const unpack =
    "mkdir -p /tmp/probe && tar -xf - -C /tmp/probe && exec /bin/sh /tmp/probe/";
  return {
    volume,
    mount,
    reader_mount: readerMount,
    containers: {
      init: make(
        "init",
        "0:0",
        'test "$(stat -c %u:%g /state)" = 0:0 && chmod 0733 /state && test "$(stat -c %a /state)" = 733',
        false,
      ),
      writer: make("writer", "1000:1000", unpack + "writer.sh", true),
      seal: make(
        "seal",
        "0:0",
        'test -d /state/pilot && chmod 0711 /state && test "$(stat -c %a /state)" = 711',
        false,
      ),
      reader: make("reader", "1000:1000", unpack + "reader.sh", true),
    },
  };
}

export function bundle(directory: string): Buffer {
  const stage = join(directory, "stage");
  mkdirSync(join(stage, "lib"), { recursive: true, mode: 0o700 });
  const mapped = JSON.parse(
    readFileSync(join(HERE, "bundle.json"), "utf8"),
  ) as Record<string, string>;
  for (const [name, source] of Object.entries(mapped)) {
    assert.ok(
      !name.startsWith("/") && !name.split("/").includes(".."),
      `unsafe bundle name ${name}`,
    );
    copyFileSync(source, join(stage, name));
  }
  const files = fixtureFiles();
  for (const [name, contents] of Object.entries(files))
    writeFileSync(join(stage, name), contents, { mode: 0o600 });
  validateEventsOffline(directory, stage, files);
  const archive = join(directory, "payload.tar");
  execFileSync(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=1000",
      "--group=1000",
      "--numeric-owner",
      "-cf",
      archive,
      "-C",
      stage,
      ".",
    ],
    { timeout: 15000 },
  );
  const names = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  })
    .trim()
    .split("\n");
  for (const name of names) {
    assert.ok(
      name.startsWith("./") && !name.split("/").includes(".."),
      `unsafe archive path: ${name}`,
    );
  }
  for (const name of [
    "./writer.sh",
    "./reader.sh",
    "./register.json",
    "./open.json",
    "./checkpoint.json",
    "./node",
    "./lib/ld-linux-aarch64.so.1",
    "./continuity.ts",
    "./continuity_cli.ts",
    "./continuity_collector.ts",
    "./continuity_feedback.ts",
    "./package.json",
  ])
    assert.ok(names.includes(name), `bundle missing ${name}`);
  return readFileSync(archive);
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

export function runContainer(
  phase: string,
  item: { name: string; command: string[] },
  cidfile: string,
  call: Call,
  payload?: Buffer,
): { ok: boolean; output: string; cid?: string } {
  const command = [...item.command];
  command.splice(2, 0, "--cidfile", cidfile);
  const run = call(command, payload, 90000);
  const output = run.stdout + run.stderr;
  process.stdout.write(output.slice(0, 16000));
  let cid = "";
  try {
    cid = readFileSync(cidfile, "utf8").trim();
  } catch {
    /* no created container */
  }
  if (!/^[a-f0-9]{64}$/.test(cid)) {
    process.stdout.write(
      `STOP: ${phase} has no exact invocation container ID; retain volume and reservation\n`,
    );
    return { ok: false, output };
  }
  const inspected = call(
    [
      "docker",
      "inspect",
      "--type",
      "container",
      "--format",
      "{{json .State}}",
      cid,
    ],
    undefined,
    15000,
  );
  if (inspected.status !== 0 || inspected.error) {
    process.stdout.write(
      `STOP: ${phase} state unavailable for ${cid}; retain volume and reservation\n`,
    );
    return { ok: false, output };
  }
  let state: {
    Running?: boolean;
    Status?: string;
    ExitCode?: number;
    OOMKilled?: boolean;
  };
  try {
    state = JSON.parse(inspected.stdout);
  } catch {
    process.stdout.write(`STOP: malformed ${phase} state for ${cid}\n`);
    return { ok: false, output };
  }
  process.stdout.write(`CONTAINER_STATE ${phase} ${JSON.stringify(state)}\n`);
  if (state.Running !== false || state.Status !== "exited") {
    process.stdout.write(
      `STOP: ${phase} not proven stopped; no forced removal\n`,
    );
    return { ok: false, output };
  }
  const logs = call(["docker", "logs", "--tail", "100", cid], undefined, 15000);
  if (logs.status !== 0 || logs.error) {
    process.stdout.write(
      `STOP: ${phase} logs unavailable; retain exact container\n`,
    );
    return { ok: false, output };
  }
  if (run.status !== 0 || run.error)
    process.stdout.write(
      `STORED_LOGS ${phase}\n${(logs.stdout + logs.stderr).slice(0, 16000)}\n`,
    );
  if (run.error || run.status === null) {
    process.stdout.write(
      `STOP: ${phase} client timeout/error; retain exact container ${cid}\n`,
    );
    return { ok: false, output };
  }
  const removed = call(["docker", "rm", cid], undefined, 15000);
  if (removed.status !== 0 || removed.error) {
    process.stdout.write(
      `STOP: ${phase} exact-container cleanup failed for ${cid}\n`,
    );
    return { ok: false, output };
  }
  const inventory = call(
    ["docker", "ps", "--all", "--quiet", "--filter", `name=^/${item.name}$`],
    undefined,
    15000,
  );
  if (inventory.status !== 0 || inventory.stdout.trim() || inventory.error) {
    process.stdout.write(
      `STOP: ${phase} container absence unverified for ${item.name}\n`,
    );
    return { ok: false, output };
  }
  process.stdout.write(`EXACT_CONTAINER_REMOVED ${phase} ${cid}\n`);
  return {
    ok: run.status === 0 && state.ExitCode === 0 && state.OOMKilled === false,
    output,
    cid,
  };
}

function verifyCheckpoint(output: string): void {
  const line = output
    .split("\n")
    .find((value) => value.startsWith("CHECKPOINT_JSON="));
  assert.ok(line, "reader did not return checkpoint JSON");
  const rows = JSON.parse(line.slice("CHECKPOINT_JSON=".length)) as Array<{
    thread: {
      id: string;
      checkpoint: string;
      coordinator: string;
      revision: number;
    };
    checkpoint: {
      id: string;
      author: string;
      thread: string;
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
}

export function main(
  argv = process.argv.slice(2),
  call: Call = systemCall,
): number {
  assert.ok(
    argv.length <= 1 &&
      (argv.length === 0 ||
        argv[0] === "--bundle-check" ||
        argv[0] === "--execute"),
    "choose no arguments, --bundle-check or --execute",
  );
  verifyPins();
  const execute = argv[0] === "--execute";
  const planned = plan(
    execute ? randomUUID().replaceAll("-", "").slice(0, 12) : "000000000000",
  );
  process.stdout.write(
    JSON.stringify({
      executing: execute,
      image: IMAGE,
      engine: ENGINE,
      volume: planned.volume,
      mount: planned.mount,
      reader_mount: planned.reader_mount,
      containers: planned.containers,
      no_host_mounts: true,
      no_credentials_or_model_calls: true,
    }) + "\n",
  );
  if (!execute && argv[0] !== "--bundle-check") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-checkpoint-ts-container-"));
  try {
    const payload = bundle(directory);
    const bundleDigest = createHash("sha256").update(payload).digest("hex");
    assert.equal(
      bundleDigest,
      BUNDLE_SHA256,
      "reviewed payload bundle changed",
    );
    process.stdout.write(
      `BUNDLE_VERIFIED bytes=${payload.length} sha256=${bundleDigest}\n`,
    );
    if (!execute) return 0;
    assert.ok(
      process.env.ROE_RUNTIME_TOKEN,
      "registered Firstmate reservation required",
    );
    const server = JSON.parse(
      mustSucceed(
        call(
          ["docker", "version", "--format", "{{json .Server}}"],
          undefined,
          15000,
        ),
        "engine check",
      ),
    );
    assert.equal(
      server.Version,
      ENGINE.Version,
      "Docker engine version changed",
    );
    assert.equal(
      server.GitCommit,
      ENGINE.GitCommit,
      "Docker engine revision changed",
    );
    assert.equal(
      server.Arch,
      ENGINE.Arch,
      "Docker engine architecture changed",
    );
    let created = false;
    try {
      const before = call(
        [
          "docker",
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=^${planned.volume}$`,
        ],
        undefined,
        15000,
      );
      assert.equal(
        before.error,
        undefined,
        "pre-existing volume inventory unavailable",
      );
      assert.equal(before.status, 0, "pre-existing volume inventory failed");
      assert.equal(
        before.stdout.trim(),
        "",
        "refuse to reuse an existing volume",
      );
      const volume = mustSucceed(
        call(
          [
            "docker",
            "volume",
            "create",
            "--label",
            "net.rockofeye.purpose=checkpoint-ts-fixture",
            planned.volume,
          ],
          undefined,
          15000,
        ),
        "volume create",
      );
      created = true;
      assert.equal(
        volume,
        planned.volume,
        "unexpected created volume identity",
      );
      const seenContainers = new Set<string>();
      for (const [phase, item] of Object.entries(planned.containers)) {
        const result = runContainer(
          phase,
          item,
          join(directory, `${phase}.cid`),
          call,
          phase === "writer" || phase === "reader" ? payload : undefined,
        );
        if (!result.ok)
          throw new Error(`${phase} failed; exact volume retained for review`);
        assert.ok(
          result.cid && !seenContainers.has(result.cid),
          `${phase} did not use a distinct container`,
        );
        seenContainers.add(result.cid);
        if (phase === "writer")
          assert.ok(
            result.output.includes(
              "PASS: TypeScript checkpoint committed in private role directory",
            ),
          );
        if (phase === "reader") verifyCheckpoint(result.output);
      }
      assert.equal(
        mustSucceed(
          call(["docker", "volume", "rm", planned.volume], undefined, 15000),
          "exact volume removal",
        ),
        planned.volume,
        "unexpected removed volume identity",
      );
      const inventory = call(
        [
          "docker",
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=^${planned.volume}$`,
        ],
        undefined,
        15000,
      );
      assert.equal(inventory.error, undefined, "volume inventory unavailable");
      assert.equal(inventory.status, 0, "volume inventory failed");
      assert.equal(
        inventory.stdout.trim(),
        "",
        "exact volume still present after removal",
      );
      created = false;
      process.stdout.write(
        `PASS: merged TypeScript checkpoint survived writer-container removal and reader-container creation; volume ${planned.volume} removed\n`,
      );
      return 0;
    } finally {
      if (created)
        process.stdout.write(
          `STOP: retained exact synthetic volume ${planned.volume}; reconcile before recovery or retry\n`,
        );
    }
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

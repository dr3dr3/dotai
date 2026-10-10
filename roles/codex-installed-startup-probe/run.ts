#!/usr/bin/env node
/** Credential-free app-server initialization against a disposable clone of installed state. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
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
import {
  inertProfile,
  statePlan,
  verifyNativeCodex,
} from "../../scripts/roe-role.ts";
import {
  inspectVolume,
  contract,
  type Result,
} from "../../scripts/roe-role-state.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BASE = "cd7566e2387b62629820eac3d4a574aa16a028b3";
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const SECCOMP = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
type Call = (argv: string[], input?: Buffer, timeoutMs?: number) => Result;
type Container = { name: string; command: string[] };

function systemCall(argv: string[], input?: Buffer, timeoutMs = 90000): Result {
  const run = spawnSync(argv[0], argv.slice(1), {
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
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    error: run.error,
  };
}

function success(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} client failed`);
  assert.equal(
    result.status,
    0,
    `${label} failed: ${(result.stdout + result.stderr).slice(0, 2000)}`,
  );
  return result.stdout.trim();
}

export function startupProfile(): object {
  const value = structuredClone(inertProfile("pilot", "codex")) as {
    meta: { name: string };
    filesystem: { read: string[]; read_file: string[] };
  };
  value.meta.name = "roe-pilot-installed-startup";
  value.filesystem.read = value.filesystem.read.filter(
    (path) => path !== "/tmp/probe/context",
  );
  value.filesystem.read.push("/tmp/probe");
  value.filesystem.read_file = value.filesystem.read_file.filter(
    (file) => file !== "/tmp/probe/check.sh",
  );
  return value;
}

export function verifyInputs(): { profile: Buffer; binary: string } {
  execFileSync("git", [
    "-C",
    ROOT,
    "merge-base",
    "--is-ancestor",
    BASE,
    "HEAD",
  ]);
  const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
    files: Record<string, string>;
    profile_sha256: string;
    bundle_sha256: string;
  };
  const native = JSON.parse(
    readFileSync(resolve(ROOT, "roles/codex-runtime.json"), "utf8"),
  ) as { path: string };
  const files = [
    fileURLToPath(import.meta.url),
    join(HERE, "entry.sh"),
    join(HERE, "start.sh"),
    resolve(ROOT, "scripts/roe-role.ts"),
    resolve(ROOT, "scripts/roe-role-state.ts"),
    resolve(ROOT, "roles/catalogue.json"),
    resolve(ROOT, "roles/codex-runtime.json"),
    NONO,
    SECCOMP,
  ];
  assert.deepEqual(
    Object.keys(pins.files).sort(),
    files.sort(),
    "reviewed input set changed",
  );
  for (const file of files)
    assert.equal(
      digest(readFileSync(file)),
      pins.files[file],
      `pinned input changed: ${file}`,
    );
  const profile = Buffer.from(JSON.stringify(startupProfile(), null, 2) + "\n");
  assert.equal(digest(profile), pins.profile_sha256, "startup profile changed");
  assert.equal(
    native.path,
    "/home/vscode/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-arm64/vendor/aarch64-unknown-linux-musl/bin/codex",
  );
  return { profile, binary: native.path };
}

export function plan(suffix: string): {
  installed: string;
  clone: string;
  containers: Container[];
} {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  const state = statePlan("pilot", "codex");
  const clone = `roe-codex-startup-${suffix}`;
  const base = [
    "docker",
    "run",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    `--security-opt=seccomp=${SECCOMP}`,
    "--memory=1g",
    "--memory-swap=1g",
    "--cpus=1",
    "--pids-limit=64",
  ];
  const item = (
    phase: string,
    user: string,
    mounts: string[],
    script: string,
    input = false,
  ): Container => {
    const name = `roe-codex-startup-${phase}-${suffix}`;
    const command = [
      ...base,
      ...mounts.flatMap((mount) => ["--mount", mount]),
      "--name",
      name,
      `--user=${user}`,
    ];
    if (phase === "copy" || phase === "start")
      command.push("--env", `ROE_CONTRACT_SHA256=${digest(contract())}`);
    if (phase === "start") command.push("--env", "ROE_PROBE_TOKEN=inert");
    if (input)
      command.push(
        "--tmpfs",
        "/tmp:rw,exec,nosuid,nodev,size=512m,mode=1777",
        "--interactive",
      );
    command.push(
      "--entrypoint",
      "/usr/bin/timeout",
      IMAGE,
      "--signal=TERM",
      "--kill-after=5s",
      "60s",
      "/bin/sh",
      "-c",
      script,
    );
    return { name, command };
  };
  const target = `type=volume,src=${clone},dst=/state,volume-nocopy`;
  return {
    installed: state.volume,
    clone,
    containers: [
      item(
        "init",
        "0:0",
        [target],
        'test "$(stat -c %u:%g /state)" = 0:0 && chmod 0733 /state',
      ),
      item(
        "copy",
        "1000:1000",
        [
          `type=volume,src=${state.volume},dst=/source,volume-nocopy,readonly`,
          target,
        ],
        'test "$(stat -c %u:%g:%a /source/pilot)" = 1000:1000:700 && test -z "$(find /source/pilot/home ! -type d)" && cp -a /source/pilot /state/pilot && test "$(sha256sum /state/pilot/contract.json | cut -d " " -f 1)" = "$ROE_CONTRACT_SHA256"',
      ),
      item(
        "seal",
        "0:0",
        [target],
        'test "$(stat -c %a /state)" = 733 && chmod 0711 /state',
      ),
      item(
        "start",
        "1000:1000",
        [target],
        "mkdir -m 700 /tmp/probe && tar -xf - -C /tmp/probe && exec /bin/sh /tmp/probe/entry.sh",
        true,
      ),
    ],
  };
}

export function bundle(
  directory: string,
  profile: Buffer,
  binary: string,
): Buffer {
  const stage = join(directory, "stage");
  mkdirSync(stage, { mode: 0o700 });
  for (const [source, name] of [
    [NONO, "nono"],
    [binary, "codex"],
    [join(HERE, "entry.sh"), "entry.sh"],
    [join(HERE, "start.sh"), "start.sh"],
  ]) {
    copyFileSync(source, join(stage, name));
    if (name === "nono" || name === "codex")
      chmodSync(join(stage, name), 0o755);
  }
  writeFileSync(join(stage, "profile.json"), profile, { mode: 0o600 });
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
    { timeout: 30000 },
  );
  const names = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
    timeout: 15000,
  })
    .trim()
    .split("\n");
  assert.deepEqual(
    names.sort(),
    [
      "./",
      "./codex",
      "./entry.sh",
      "./nono",
      "./profile.json",
      "./start.sh",
    ].sort(),
  );
  return readFileSync(archive);
}

function runContainer(
  item: Container,
  cidfile: string,
  call: Call,
  payload?: Buffer,
): { ok: boolean; output: string } {
  const command = [...item.command];
  command.splice(2, 0, "--cidfile", cidfile);
  const run = call(command, payload, 90000);
  const output = run.stdout + run.stderr;
  process.stdout.write(output.slice(0, 16000));
  let cid = "";
  try {
    cid = readFileSync(cidfile, "utf8").trim();
  } catch {
    /* no exact ID */
  }
  assert.match(
    cid,
    /^[a-f0-9]{64}$/,
    `${item.name}: exact container ID unavailable; retain clone and reservation`,
  );
  const state = JSON.parse(
    success(
      call(
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
      ),
      "container inspect",
    ),
  ) as {
    Running: boolean;
    Status: string;
    ExitCode: number;
    OOMKilled: boolean;
  };
  assert.equal(
    state.Running,
    false,
    `${item.name} still running; retain container`,
  );
  assert.equal(
    state.Status,
    "exited",
    `${item.name} state uncertain; retain container`,
  );
  assert.equal(state.OOMKilled, false, `${item.name} OOM killed`);
  const logs = success(
    call(["docker", "logs", "--tail", "100", cid], undefined, 15000),
    "container logs",
  );
  if (run.status !== 0)
    process.stdout.write(`STORED_LOGS ${item.name}\n${logs.slice(0, 16000)}\n`);
  assert.ok(
    !run.error && run.status !== null,
    `${item.name} client error; retain container`,
  );
  success(
    call(["docker", "rm", cid], undefined, 15000),
    "exact container removal",
  );
  assert.equal(
    success(
      call(
        [
          "docker",
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `name=^/${item.name}$`,
        ],
        undefined,
        15000,
      ),
      "container absence",
    ),
    "",
  );
  process.stdout.write(`EXACT_CONTAINER_REMOVED ${item.name} ${cid}\n`);
  return { ok: run.status === 0 && state.ExitCode === 0, output };
}

function verifyStartup(output: string): void {
  assert.match(output, /^SANDBOX_DENIALS_OK$/m);
  assert.match(output, /^APP_SERVER_EXITED_CLEANLY$/m);
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.match(output, new RegExp(`^${name}:\\s*0+$`, "m"));
  assert.match(output, /^NoNewPrivs:\s*1$/m);
  assert.match(output, /^Seccomp:\s*2$/m);
  const replies = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as {
          id?: number;
          method?: string;
          result?: unknown;
          error?: unknown;
        };
      } catch {
        return null;
      }
    })
    .filter((value) => value !== null);
  assert.equal(
    replies.filter((value) => value.id === 1).length,
    1,
    "expected exactly one initialize reply",
  );
  assert.ok(
    !replies.some((value) => value.method && value.id !== undefined),
    "unexpected server request",
  );
  const reply = replies.find((value) => value.id === 1)!;
  assert.equal(reply.id, 1);
  assert.ok(reply.result && !reply.error, "Codex initialization failed");
  assert.ok(!output.includes('"method":"thread/'), "unexpected thread request");
}

export async function main(
  args = process.argv.slice(2),
  call: Call = systemCall,
): Promise<number> {
  assert.ok(
    args.length <= 1 &&
      (args.length === 0 ||
        ["--plan", "--bundle-check", "--execute"].includes(args[0])),
    "choose --plan, --bundle-check or --execute",
  );
  const { profile, binary } = verifyInputs();
  const native = await verifyNativeCodex();
  const execute = args[0] === "--execute";
  if (execute)
    assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
  const planned = plan(
    execute ? randomUUID().replaceAll("-", "").slice(0, 12) : "000000000000",
  );
  process.stdout.write(
    JSON.stringify({
      mode: execute ? "execute" : "plan-only",
      native,
      image: IMAGE,
      engine: ENGINE,
      ...planned,
      credential_free: true,
      provider_calls: false,
      installed_volume_readonly: true,
      activation: "disabled",
    }) + "\n",
  );
  if (!execute && args[0] !== "--bundle-check") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-codex-installed-startup-"));
  try {
    const payload = bundle(directory, profile, binary);
    const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
      bundle_sha256: string;
    };
    assert.equal(
      digest(payload),
      pins.bundle_sha256,
      "reviewed bundle changed",
    );
    process.stdout.write(
      `BUNDLE_VERIFIED bytes=${payload.length} sha256=${digest(payload)}\n`,
    );
    if (!execute) return 0;
    const server = JSON.parse(
      success(
        call(
          ["docker", "version", "--format", "{{json .Server}}"],
          undefined,
          15000,
        ),
        "engine check",
      ),
    ) as typeof ENGINE;
    for (const [key, value] of Object.entries(ENGINE))
      assert.equal(server[key as keyof typeof ENGINE], value);
    const state = statePlan("pilot", "codex");
    inspectVolume(
      call(
        ["docker", "volume", "inspect", "--format", "{{json .}}", state.volume],
        undefined,
        15000,
      ),
      state,
    );
    assert.equal(
      success(
        call(
          [
            "docker",
            "volume",
            "ls",
            "--quiet",
            "--filter",
            `name=^${planned.clone}$`,
          ],
          undefined,
          15000,
        ),
        "clone absence",
      ),
      "",
    );
    assert.equal(
      success(
        call(
          [
            "docker",
            "volume",
            "create",
            "--label",
            "net.rockofeye.purpose=codex-installed-startup-fixture",
            planned.clone,
          ],
          undefined,
          15000,
        ),
        "clone create",
      ),
      planned.clone,
    );
    let created = true;
    try {
      for (const item of planned.containers) {
        const result = runContainer(
          item,
          join(directory, `${item.name}.cid`),
          call,
          item.name.includes("-start-") ? payload : undefined,
        );
        assert.ok(
          result.ok,
          `${item.name} failed; retain clone and reservation`,
        );
        if (item.name.includes("-start-")) verifyStartup(result.output);
      }
      assert.equal(
        success(
          call(["docker", "volume", "rm", planned.clone], undefined, 15000),
          "clone removal",
        ),
        planned.clone,
      );
      assert.equal(
        success(
          call(
            [
              "docker",
              "volume",
              "ls",
              "--quiet",
              "--filter",
              `name=^${planned.clone}$`,
            ],
            undefined,
            15000,
          ),
          "clone absence after removal",
        ),
        "",
      );
      inspectVolume(
        call(
          [
            "docker",
            "volume",
            "inspect",
            "--format",
            "{{json .}}",
            state.volume,
          ],
          undefined,
          15000,
        ),
        state,
      );
      created = false;
      process.stdout.write(
        `PASS: Codex initialized against installed-state clone; installed ${state.volume} preserved; activation disabled\n`,
      );
      return 0;
    } finally {
      if (created)
        process.stdout.write(
          `STOP: retain exact clone ${planned.clone} and reservation for reconciliation; installed volume untouched\n`,
        );
    }
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `codex-installed-startup: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}

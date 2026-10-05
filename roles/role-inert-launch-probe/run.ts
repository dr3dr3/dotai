#!/usr/bin/env node
/** Inert TypeScript launcher/profile binding; plan-only without reservation. */
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
  runContainer,
  type Call,
} from "../checkpoint-ts-container-probe/run.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI = resolve(HERE, "../..");
const SOURCE_COMMIT = "b3d9cf811b9770e9fde03a50b9ec1a888a6c4142";
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const NONO_SHA256 =
  "520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9";
const POLICY = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const REQUIRED = [
  "PASS: unsandboxed positive controls and private role directory",
  "PASS: intended reads and scoped writes; protected, sibling and child denials; filtered environment",
];

type Result = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function systemCall(argv: string[], input?: Buffer, timeoutMs = 75000): Result {
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

const digest = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function profileBytes(): Buffer {
  return Buffer.from(
    JSON.stringify(inertProfile("pilot", "codex"), null, 2) + "\n",
  );
}

export function verifyInputs(): void {
  assert.equal(
    execFileSync("git", ["-C", DOTAI, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    SOURCE_COMMIT,
  );
  const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
    files: Record<string, string>;
    profile_sha256: string;
    bundle_sha256: string;
  };
  const files = [
    fileURLToPath(import.meta.url),
    resolve(HERE, "../../scripts/roe-role.ts"),
    resolve(HERE, "../checkpoint-ts-container-probe/run.ts"),
    resolve(HERE, "../catalogue.json"),
    resolve(HERE, "../codex-runtime.json"),
    join(HERE, "entry.sh"),
    join(HERE, "check.sh"),
    NONO,
    POLICY,
  ];
  assert.deepEqual(
    Object.keys(pins.files).sort(),
    files.sort(),
    "pinned input set changed",
  );
  for (const file of files)
    assert.equal(
      digest(file),
      pins.files[file],
      `pinned input changed: ${file}`,
    );
  assert.equal(pins.files[NONO], NONO_SHA256, "nono binary pin changed");
  assert.equal(
    createHash("sha256").update(profileBytes()).digest("hex"),
    pins.profile_sha256,
    "generated policy changed",
  );
}

export type Planned = {
  volume: string;
  labels: Record<string, string>;
  mount: string;
  containers: Record<string, { name: string; command: string[] }>;
};

export function plan(suffix: string): Planned {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  const state = statePlan("pilot", "codex");
  const base = [
    "docker",
    "run",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--pids-limit=64",
    "--mount",
    state.mount,
  ];
  const name = (phase: string) => `roe-role-inert-${phase}-${suffix}`;
  return {
    volume: state.volume,
    labels: state.labels,
    mount: state.mount,
    containers: {
      init: {
        name: name("init"),
        command: [
          ...base,
          "--name",
          name("init"),
          "--user=0:0",
          "--entrypoint",
          "/usr/bin/timeout",
          IMAGE,
          "--signal=TERM",
          "--kill-after=5s",
          "60s",
          "/bin/sh",
          "-c",
          'test "$(stat -c %u:%g /state)" = 0:0 && chmod 0733 /state && test "$(stat -c %a /state)" = 733',
        ],
      },
      inert: {
        name: name("inert"),
        command: [
          ...base,
          "--name",
          name("inert"),
          "--user=1000:1000",
          `--security-opt=seccomp=${POLICY}`,
          "--tmpfs",
          "/tmp:rw,exec,nosuid,nodev,size=128m,mode=1777",
          "--interactive",
          "--entrypoint",
          "/usr/bin/timeout",
          IMAGE,
          "--signal=TERM",
          "--kill-after=5s",
          "60s",
          "/bin/sh",
          "-c",
          "mkdir -p /tmp/probe && tar -xf - -C /tmp/probe && exec /bin/sh /tmp/probe/entry.sh",
        ],
      },
    },
  };
}

export function bundle(directory: string): Buffer {
  const stage = join(directory, "stage");
  mkdirSync(stage, { mode: 0o700 });
  copyFileSync(NONO, join(stage, "nono"));
  chmodSync(join(stage, "nono"), 0o755);
  for (const name of ["entry.sh", "check.sh"])
    copyFileSync(join(HERE, name), join(stage, name));
  writeFileSync(join(stage, "profile.json"), profileBytes(), { mode: 0o600 });
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
  const entries = execFileSync("tar", ["-tf", archive], {
    encoding: "utf8",
    timeout: 15000,
  })
    .trim()
    .split("\n");
  for (const name of entries)
    assert.ok(
      name.startsWith("./") && !name.split("/").includes(".."),
      `unsafe bundle path ${name}`,
    );
  for (const name of ["./nono", "./entry.sh", "./check.sh", "./profile.json"])
    assert.ok(entries.includes(name), `bundle missing ${name}`);
  return readFileSync(archive);
}

function success(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} failed to start`);
  assert.equal(
    result.status,
    0,
    `${label} failed: ${(result.stdout + result.stderr).slice(0, 2000)}`,
  );
  return result.stdout.trim();
}

export function checkVolumeInspection(result: Result, planned: Planned): void {
  const record = JSON.parse(success(result, "volume inspect")) as {
    Name?: unknown;
    Driver?: unknown;
    Scope?: unknown;
    Labels?: unknown;
    Options?: unknown;
  };
  assert.equal(record.Name, planned.volume);
  assert.equal(record.Driver, "local");
  assert.equal(record.Scope, "local");
  assert.deepEqual(record.Labels, planned.labels);
  assert.ok(
    record.Options === null ||
      (typeof record.Options === "object" &&
        record.Options !== null &&
        !Array.isArray(record.Options) &&
        Object.keys(record.Options).length === 0),
    "volume driver options are forbidden",
  );
}

function verifyOutput(output: string): void {
  for (const line of REQUIRED)
    assert.ok(output.includes(line), `missing acceptance: ${line}`);
  assert.ok(output.includes("nono 0.76.0"), "nono version missing");
  const caps = Object.fromEntries(
    [...output.matchAll(/^(Cap\w+):\s*([0-9a-fA-F]+)$/gm)].map((match) => [
      match[1],
      Number.parseInt(match[2], 16),
    ]),
  );
  for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
    assert.equal(caps[name], 0, `${name} was not zero`);
  assert.match(output, /^NoNewPrivs:\s*1$/m);
  assert.match(output, /^Seccomp:\s*2$/m);
}

export async function main(
  argv = process.argv.slice(2),
  call: Call = systemCall,
): Promise<number> {
  assert.ok(
    argv.length <= 1 &&
      (argv.length === 0 || ["--bundle-check", "--execute"].includes(argv[0])),
    "choose no arguments, --bundle-check or --execute",
  );
  verifyInputs();
  await verifyNativeCodex();
  const execute = argv[0] === "--execute";
  const planned = plan(
    execute ? randomUUID().replaceAll("-", "").slice(0, 12) : "000000000000",
  );
  process.stdout.write(
    JSON.stringify({
      executing: execute,
      image: IMAGE,
      engine: ENGINE,
      ...planned,
      no_host_mounts: true,
      no_credentials_or_model_calls: true,
      role_activation: "disabled",
    }) + "\n",
  );
  if (!execute && argv[0] !== "--bundle-check") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-role-inert-"));
  try {
    const payload = bundle(directory);
    const actual = createHash("sha256").update(payload).digest("hex");
    const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
      bundle_sha256: string;
    };
    assert.equal(actual, pins.bundle_sha256, "reviewed bundle changed");
    process.stdout.write(
      `BUNDLE_VERIFIED bytes=${payload.length} sha256=${actual}\n`,
    );
    if (!execute) return 0;
    assert.ok(
      process.env.ROE_RUNTIME_TOKEN,
      "registered Firstmate reservation required",
    );
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
      assert.equal(
        server[key as keyof typeof ENGINE],
        value,
        `engine ${key} changed`,
      );
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
      success(before, "volume absence check"),
      "",
      "candidate role volume already exists",
    );
    const create = ["docker", "volume", "create"];
    for (const [key, value] of Object.entries(planned.labels))
      create.push("--label", `${key}=${value}`);
    create.push(planned.volume);
    let created = false;
    try {
      assert.equal(
        success(call(create, undefined, 15000), "volume create"),
        planned.volume,
      );
      created = true;
      process.stdout.write(`VOLUME_CREATED ${planned.volume}\n`);
      checkVolumeInspection(
        call(
          [
            "docker",
            "volume",
            "inspect",
            "--format",
            "{{json .}}",
            planned.volume,
          ],
          undefined,
          15000,
        ),
        planned,
      );
      const init = runContainer(
        "init",
        planned.containers.init,
        join(directory, "init.cid"),
        call,
      );
      assert.ok(init.ok, "init failed; retain exact volume and reservation");
      const inert = runContainer(
        "inert",
        planned.containers.inert,
        join(directory, "inert.cid"),
        call,
        payload,
      );
      assert.ok(
        inert.ok,
        "inert boundary failed; retain exact volume and reservation",
      );
      verifyOutput(inert.output);
      assert.equal(
        success(
          call(["docker", "volume", "rm", planned.volume], undefined, 15000),
          "exact volume removal",
        ),
        planned.volume,
      );
      const after = call(
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
        success(after, "volume absence check"),
        "",
        "candidate role volume still present",
      );
      created = false;
      process.stdout.write(
        `PASS: inert TypeScript launch plan and nono boundary; exact volume ${planned.volume} removed\n`,
      );
      return 0;
    } finally {
      if (created)
        process.stdout.write(
          `STOP: retain exact volume ${planned.volume} and reservation for reconciliation\n`,
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
      process.stdout.write(
        `STOP: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}

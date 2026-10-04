/** Trusted, credential-free preparation of the private Pilot state volume. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RoleStatePlan = {
  volume: string;
  labels: Record<string, string>;
  mount: string;
  role_directory: string;
  home: string;
  continuity_db: string;
};
export type Result = {
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
export type Operation = "prepare" | "doctor";

const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const NONO_SHA256 =
  "520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9";
const SECCOMP = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const SECCOMP_SHA256 =
  "189935cc4abea601443cca1d6dde03f9de2e5c01f789778edbd78445d1e466a6";
const PROFILE_SHA256 =
  "f72771dc1fad3131882e5ec7714d597b8e31e3a9c937c59ef82e2ba7cbeb24eb";
const INSTRUCTIONS = "Role activation disabled\n";
const PREPARE = `set -eu
umask 077
test "$(stat -c %a /state)" = 733
test ! -e /state/pilot
mkdir -m 700 /state/pilot
mkdir -p /state/pilot/work /state/pilot/continuity /state/pilot/output \
  /state/pilot/tmp /state/pilot/home/.codex \
  /state/pilot/home/.config/roe-advisor \
  /state/pilot/home/.cache/roe-advisor \
  /state/pilot/home/.local/state/roe-advisor
printf '%s\\n' "$ROE_CONTRACT" > /state/pilot/contract.json
printf '%s\\n' 'Role activation disabled' > /state/pilot/instructions.md
chmod 400 /state/pilot/contract.json /state/pilot/instructions.md
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
printf 'STATE_PREPARED\\n'`;
const DOCTOR = `set -eu
test "$(stat -c %u:%g:%a /state)" = 0:0:711
test "$(find /state -mindepth 1 -maxdepth 1 | wc -l)" -eq 1
for dir in /state/pilot /state/pilot/work /state/pilot/continuity \
  /state/pilot/output /state/pilot/tmp /state/pilot/home \
  /state/pilot/home/.codex /state/pilot/home/.config \
  /state/pilot/home/.config/roe-advisor /state/pilot/home/.cache \
  /state/pilot/home/.cache/roe-advisor /state/pilot/home/.local \
  /state/pilot/home/.local/state \
  /state/pilot/home/.local/state/roe-advisor; do
  test ! -L "$dir"
  test "$(stat -c %u:%g:%a "$dir")" = 1000:1000:700
done
for file in /state/pilot/contract.json /state/pilot/instructions.md; do
  test ! -L "$file"
  test "$(stat -c %u:%g:%a "$file")" = 1000:1000:400
done
test "$(sha256sum /state/pilot/contract.json | cut -d ' ' -f 1)" = "$ROE_CONTRACT_SHA256"
test "$(sha256sum /state/pilot/instructions.md | cut -d ' ' -f 1)" = "$ROE_INSTRUCTIONS_SHA256"
test -z "$(find /state/pilot/home -type f -o -type l)"
printf 'STATE_DOCTOR_OK\\n'`;

function systemCall(argv: string[], input?: Buffer, timeoutMs = 90000): Result {
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

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

export function contract(profileSha256 = PROFILE_SHA256): string {
  return (
    JSON.stringify({
      schema_version: 1,
      role: "pilot",
      harness: "codex",
      profile_sha256: profileSha256,
    }) + "\n"
  );
}

export function verifyPolicy(profile: object): void {
  assert.equal(sha256(readFileSync(NONO)), NONO_SHA256, "nono pin changed");
  assert.equal(
    sha256(readFileSync(SECCOMP)),
    SECCOMP_SHA256,
    "seccomp policy changed",
  );
  assert.equal(
    sha256(JSON.stringify(profile, null, 2) + "\n"),
    PROFILE_SHA256,
    "generated role profile changed",
  );
}

function success(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} client error`);
  assert.equal(
    result.status,
    0,
    `${label} failed: ${(result.stdout + result.stderr).slice(0, 2000)}`,
  );
  return result.stdout.trim();
}

export function inspectVolume(result: Result, plan: RoleStatePlan): void {
  const record = JSON.parse(success(result, "volume inspect")) as {
    Name?: unknown;
    Driver?: unknown;
    Scope?: unknown;
    Labels?: unknown;
    Options?: unknown;
  };
  assert.equal(record.Name, plan.volume);
  assert.equal(record.Driver, "local");
  assert.equal(record.Scope, "local");
  assert.deepEqual(record.Labels, plan.labels);
  assert.ok(
    record.Options === null ||
      (typeof record.Options === "object" &&
        record.Options !== null &&
        !Array.isArray(record.Options) &&
        Object.keys(record.Options).length === 0),
    "volume driver options forbidden",
  );
}

type Container = { name: string; command: string[] };

function container(
  plan: RoleStatePlan,
  suffix: string,
  phase: "init" | "prepare" | "seal" | "doctor",
  contractJson: string,
): Container {
  const name = `roe-role-state-${phase}-${suffix}`;
  const mount = phase === "doctor" ? `${plan.mount},readonly` : plan.mount;
  const base = [
    "docker",
    "run",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    `--security-opt=seccomp=${SECCOMP}`,
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--pids-limit=64",
    "--mount",
    mount,
    "--name",
    name,
    `--user=${phase === "init" || phase === "seal" ? "0:0" : "1000:1000"}`,
    "--entrypoint",
    "/usr/bin/timeout",
    IMAGE,
    "--signal=TERM",
    "--kill-after=5s",
    "60s",
    "/bin/sh",
    "-c",
  ];
  if (phase === "init")
    base.push(
      'test "$(stat -c %u:%g /state)" = 0:0 && chmod 0733 /state && test "$(stat -c %a /state)" = 733',
    );
  if (phase === "seal")
    base.push(
      'test "$(stat -c %a /state)" = 733 && chmod 0711 /state && test "$(stat -c %a /state)" = 711',
    );
  if (phase === "prepare") {
    base.splice(
      base.indexOf("--entrypoint"),
      0,
      "--env",
      `ROE_CONTRACT=${contractJson.trimEnd()}`,
    );
    base.push(PREPARE);
  }
  if (phase === "doctor") {
    base.splice(
      base.indexOf("--entrypoint"),
      0,
      "--env",
      `ROE_CONTRACT_SHA256=${sha256(contractJson)}`,
      "--env",
      `ROE_INSTRUCTIONS_SHA256=${sha256(INSTRUCTIONS)}`,
    );
    base.push(DOCTOR);
  }
  return { name, command: base };
}

export function operationPlan(
  mode: Operation,
  plan: RoleStatePlan,
  suffix: string,
): { volume: string; containers: Container[]; contract_sha256: string } {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  assert.equal(plan.volume, "roe-role-pilot-state-v1");
  assert.equal(
    plan.mount,
    "type=volume,src=roe-role-pilot-state-v1,dst=/state,volume-nocopy",
    "private volume mount changed",
  );
  assert.equal(plan.role_directory, "/state/pilot");
  assert.equal(plan.home, "/state/pilot/home");
  assert.equal(
    plan.continuity_db,
    "/state/pilot/continuity/continuity.sqlite3",
  );
  const contractJson = contract();
  return {
    volume: plan.volume,
    contract_sha256: sha256(contractJson),
    containers:
      mode === "prepare"
        ? (["init", "prepare", "seal", "doctor"] as const).map((phase) =>
            container(plan, suffix, phase, contractJson),
          )
        : [container(plan, suffix, "doctor", contractJson)],
  };
}

function runContainer(item: Container, cidfile: string, call: Call): string {
  const command = [...item.command];
  command.splice(2, 0, "--cidfile", cidfile);
  const run = call(command, undefined, 90000);
  const output = run.stdout + run.stderr;
  process.stdout.write(output.slice(0, 16000));
  let cid = "";
  try {
    cid = readFileSync(cidfile, "utf8").trim();
  } catch {
    /* no proven container */
  }
  assert.match(
    cid,
    /^[a-f0-9]{64}$/,
    `${item.name} has no exact container ID; retain volume and reservation`,
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
    Running?: boolean;
    Status?: string;
    ExitCode?: number;
    OOMKilled?: boolean;
  };
  assert.equal(state.Running, false, "container not proven stopped");
  assert.equal(state.Status, "exited", "container not proven exited");
  assert.equal(state.OOMKilled, false, "container was OOM killed");
  success(
    call(["docker", "logs", "--tail", "100", cid], undefined, 15000),
    "container logs",
  );
  if (run.error || run.status === null)
    throw new Error(
      `container client uncertain: retain ${cid} and reservation`,
    );
  assert.equal(
    success(
      call(["docker", "rm", cid], undefined, 15000),
      "exact container removal",
    ),
    cid,
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
    "container absence unverified",
  );
  process.stdout.write(`EXACT_CONTAINER_REMOVED ${item.name} ${cid}\n`);
  assert.equal(run.status, 0, `container failed: ${item.name}`);
  assert.equal(state.ExitCode, 0, `container exit failed: ${item.name}`);
  return output;
}

export function operate(
  mode: Operation,
  plan: RoleStatePlan,
  profile: object,
  call: Call = systemCall,
): void {
  verifyPolicy(profile);
  assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const planned = operationPlan(mode, plan, suffix);
  const server = JSON.parse(
    success(
      call(
        ["docker", "version", "--format", "{{json .Server}}"],
        undefined,
        15000,
      ),
      "engine",
    ),
  ) as typeof ENGINE;
  for (const [key, value] of Object.entries(ENGINE))
    assert.equal(
      server[key as keyof typeof ENGINE],
      value,
      `engine ${key} changed`,
    );
  const current = success(
    call(
      [
        "docker",
        "volume",
        "ls",
        "--quiet",
        "--filter",
        `name=^${plan.volume}$`,
      ],
      undefined,
      15000,
    ),
    "volume inventory",
  );
  assert.ok(
    current === "" || current === plan.volume,
    "ambiguous volume inventory",
  );
  if (mode === "doctor")
    assert.equal(current, plan.volume, "role state volume missing");
  if (current === plan.volume)
    inspectVolume(
      call(
        ["docker", "volume", "inspect", "--format", "{{json .}}", plan.volume],
        undefined,
        15000,
      ),
      plan,
    );
  if (mode === "prepare" && current === plan.volume) {
    const directory = mkdtempSync(join(tmpdir(), "roe-role-doctor-"));
    try {
      const output = runContainer(
        operationPlan("doctor", plan, suffix).containers[0],
        join(directory, "doctor.cid"),
        call,
      );
      assert.ok(output.includes("STATE_DOCTOR_OK"), "doctor marker missing");
      process.stdout.write(`STATE_ALREADY_PREPARED ${plan.volume}\n`);
      return;
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
  if (mode === "prepare") {
    const create = ["docker", "volume", "create", "--driver", "local"];
    for (const [key, value] of Object.entries(plan.labels))
      create.push("--label", `${key}=${value}`);
    create.push(plan.volume);
    assert.equal(
      success(call(create, undefined, 15000), "volume create"),
      plan.volume,
    );
    process.stdout.write(`VOLUME_CREATED ${plan.volume}\n`);
    inspectVolume(
      call(
        ["docker", "volume", "inspect", "--format", "{{json .}}", plan.volume],
        undefined,
        15000,
      ),
      plan,
    );
  }
  const directory = mkdtempSync(join(tmpdir(), "roe-role-state-"));
  try {
    for (const item of planned.containers) {
      const phase = item.name.split("-").at(-2);
      const output = runContainer(item, join(directory, `${phase}.cid`), call);
      if (phase === "prepare") assert.ok(output.includes("STATE_PREPARED"));
      if (phase === "doctor") assert.ok(output.includes("STATE_DOCTOR_OK"));
    }
    process.stdout.write(
      `PASS: role state ${mode} ${plan.volume}; activation disabled\n`,
    );
  } catch (error) {
    process.stdout.write(
      `STOP: retain exact volume ${plan.volume} and Firstmate reservation for reconciliation\n`,
    );
    throw error;
  } finally {
    rmSync(directory, { recursive: true });
  }
}

#!/usr/bin/env node
/** Reserved, operator-only Codex API-project turn against disposable private state. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { statePlan, verifyNativeCodex } from "../../scripts/roe-role.ts";
import { contract, inspectVolume, type Result } from "../../scripts/roe-role-state.ts";
import { runClient } from "./client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const SECCOMP = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const IMAGE = "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const MODEL = "gpt-6-luna";
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const sha = (file: string) => digest(readFileSync(file));
const safeError = (error: unknown) => error instanceof Error ? error.message : "unknown failure";
type Container = { name: string; command: string[] };

function call(argv: string[], input?: Buffer, timeoutMs = 90000): Result {
  const run = spawnSync(argv[0], argv.slice(1), {
    input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C", ROE_RUNTIME_TOKEN: process.env.ROE_RUNTIME_TOKEN },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error };
}

function success(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} process failed`);
  assert.equal(result.status, 0, `${label} failed; retain reservation and clone`);
  return result.stdout.trim();
}

export function verifyInputs(): { binary: string; profile: Buffer } {
  const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
    files: Record<string, string>; profile_sha256: string; bundle_sha256: string;
  };
  const files = [
    fileURLToPath(import.meta.url), join(HERE, "client.ts"), join(HERE, "entry.sh"),
    join(HERE, "profile.json"), resolve(ROOT, "scripts/roe-role.ts"),
    resolve(ROOT, "scripts/roe-role-state.ts"), resolve(ROOT, "roles/catalogue.json"),
    resolve(ROOT, "roles/codex-runtime.json"), NONO, SECCOMP,
  ];
  assert.deepEqual(Object.keys(pins.files).sort(), [...files].sort(), "reviewed input set changed");
  for (const file of files) assert.equal(sha(file), pins.files[file], `pinned input changed: ${file}`);
  const profile = readFileSync(join(HERE, "profile.json"));
  assert.equal(digest(profile), pins.profile_sha256, "profile changed");
  const policy = JSON.parse(profile.toString("utf8")) as {
    network: { allow_domain: string[] }; environment: { allow_vars: string[] };
  };
  assert.deepEqual(policy.network.allow_domain, ["api.openai.com"]);
  assert.ok(policy.environment.allow_vars.includes("ROE_PILOT_PROVIDER_TOKEN"));
  const native = JSON.parse(readFileSync(resolve(ROOT, "roles/codex-runtime.json"), "utf8")) as { path: string };
  return { binary: native.path, profile };
}

export function plan(suffix: string): { clone: string; installed: string; setup: Container[]; role: Container } {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  const installed = statePlan("pilot", "codex").volume;
  const clone = `roe-codex-provider-${suffix}`;
  const mount = `type=volume,src=${clone},dst=/state,volume-nocopy`;
  const base = ["docker", "run", "--pull=never", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", `--security-opt=seccomp=${SECCOMP}`,
    "--memory=1g", "--memory-swap=1g", "--cpus=1", "--pids-limit=64"];
  const container = (phase: string, user: string, network: string, mounts: string[], script: string, interactive = false): Container => {
    const name = `roe-codex-provider-${phase}-${suffix}`;
    const command = [...base, `--network=${network}`,
      "--label", "net.rockofeye.purpose=codex-provider-turn-fixture",
      "--label", `net.rockofeye.phase=${phase}`,
      ...mounts.flatMap((value) => ["--mount", value]),
      "--name", name, `--user=${user}`, "--env", `ROE_CONTRACT_SHA256=${digest(contract())}`];
    if (interactive) command.push("--interactive", "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777");
    command.push("--entrypoint", "/usr/bin/timeout", IMAGE, "--signal=TERM", "--kill-after=5s", "60s", "/bin/sh", "-c", script);
    return { name, command };
  };
  const setup = [
    container("init", "0:0", "none", [mount], 'test "$(stat -c %u:%g /state)" = 0:0 && chmod 0733 /state'),
    container("copy", "1000:1000", "none", [
      `type=volume,src=${installed},dst=/source,volume-nocopy,readonly`, mount,
    ], 'test "$(stat -c %u:%g:%a /source/pilot)" = 1000:1000:700 && test -z "$(find /source/pilot/home ! -type d)" && cp -a /source/pilot /state/pilot && test "$(sha256sum /state/pilot/contract.json | cut -d " " -f 1)" = "$ROE_CONTRACT_SHA256"'),
    container("seal", "0:0", "none", [mount], 'test "$(stat -c %a /state)" = 733 && chmod 0711 /state'),
    container("stage", "1000:1000", "none", [mount],
      'test "$(stat -c %a /state)" = 711 && test ! -e /state/pilot/probe && mkdir -m 700 /state/pilot/probe && tar -xf - -C /state/pilot/probe', true),
  ];
  const role = container("turn", "1000:1000", "bridge", [mount],
    "mkdir -m 700 /tmp/supervisor && exec /bin/sh /state/pilot/probe/entry.sh", true);
  role.command.splice(role.command.indexOf("--entrypoint"), 0, "--env", "ROE_PILOT_PROVIDER_TOKEN");
  return { clone, installed, setup, role };
}

export function bundle(directory: string, binary: string, profile: Buffer): Buffer {
  const stage = join(directory, "stage");
  mkdirSync(stage, { mode: 0o700 });
  for (const [source, name] of [[binary, "codex"], [NONO, "nono"], [join(HERE, "entry.sh"), "entry.sh"]]) {
    copyFileSync(source, join(stage, name));
    if (name !== "entry.sh") chmodSync(join(stage, name), 0o755);
  }
  copyFileSync(join(HERE, "profile.json"), join(stage, "profile.json"));
  assert.equal(digest(readFileSync(join(stage, "profile.json"))), digest(profile));
  const archive = join(directory, "payload.tar");
  execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=1000", "--group=1000",
    "--numeric-owner", "-cf", archive, "-C", stage, "."], { timeout: 30000 });
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(entries.sort(), ["./", "./codex", "./entry.sh", "./nono", "./profile.json"].sort());
  return readFileSync(archive);
}

function exactId(cidfile: string, name: string): string {
  let id = "";
  try { id = readFileSync(cidfile, "utf8").trim(); } catch { /* use exact labelled lookup */ }
  if (!/^[a-f0-9]{64}$/.test(id)) {
    const found = success(call(["docker", "ps", "--all", "--no-trunc", "--quiet",
      "--filter", `name=^/${name}$`,
      "--filter", "label=net.rockofeye.purpose=codex-provider-turn-fixture"], undefined, 15000), "labelled container lookup");
    assert.match(found, /^[a-f0-9]{64}$/, "exact container ID unavailable; retain reservation and revoke key");
    id = found;
  }
  return id;
}

function removeExact(id: string, name: string): void {
  success(call(["docker", "rm", "--force", id], undefined, 15000), "exact container removal");
  assert.equal(success(call(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${name}$`], undefined, 15000), "container absence"), "");
  process.stdout.write(`EXACT_CONTAINER_REMOVED ${name} ${id}\n`);
}

function runSetup(item: Container, directory: string, payload?: Buffer): void {
  const cidfile = join(directory, `${item.name}.cid`);
  const command = [...item.command];
  command.splice(2, 0, "--cidfile", cidfile);
  const result = call(command, payload, 90000);
  const id = exactId(cidfile, item.name);
  const state = JSON.parse(success(call(["docker", "inspect", "--type", "container", "--format", "{{json .State}}", id], undefined, 15000), "setup state")) as {
    Running: boolean; Status: string; ExitCode: number; OOMKilled: boolean;
  };
  assert.equal(state.Running, false);
  assert.equal(state.Status, "exited");
  assert.equal(state.OOMKilled, false);
  removeExact(id, item.name);
  assert.ok(!result.error && result.status === 0 && state.ExitCode === 0,
    `${item.name} failed; retain clone and reservation`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  assert.ok(args.length <= 1 && (args.length === 0 || ["--plan", "--bundle-check", "--execute"].includes(args[0])));
  const { binary, profile } = verifyInputs();
  const native = await verifyNativeCodex();
  assert.equal(native.path, binary);
  const execute = args[0] === "--execute";
  const planned = plan(execute ? randomUUID().replaceAll("-", "").slice(0, 12) : "000000000000");
  process.stdout.write(JSON.stringify({ mode: execute ? "execute" : "plan-only", model: MODEL,
    native, image: IMAGE, engine: ENGINE, ...planned, installed_volume_readonly: true,
    credential_source: "dedicated nonproduction API project", activation: "disabled" }) + "\n");
  if (!execute && args[0] !== "--bundle-check") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-codex-provider-"));
  try {
    const payload = bundle(directory, binary, profile);
    const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as { bundle_sha256: string };
    assert.equal(digest(payload), pins.bundle_sha256, "reviewed bundle changed");
    process.stdout.write(`BUNDLE_VERIFIED bytes=${payload.length} sha256=${digest(payload)}\n`);
    if (!execute) return 0;
    assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
    assert.ok(process.env.ROE_PILOT_PROVIDER_TOKEN, "approved API project token required");
    assert.equal(process.env.ROE_PILOT_PROJECT_CAP_USD, "50", "verified $50 project hard limit required");
    assert.equal(process.env.ROE_PILOT_PROJECT_ISOLATED, "yes", "isolated API project attestation required");
    const engine = JSON.parse(success(call(["docker", "version", "--format", "{{json .Server}}"], undefined, 15000), "engine check")) as typeof ENGINE;
    for (const [key, value] of Object.entries(ENGINE)) assert.equal(engine[key as keyof typeof ENGINE], value);
    const state = statePlan("pilot", "codex");
    inspectVolume(call(["docker", "volume", "inspect", "--format", "{{json .}}", state.volume], undefined, 15000), state);
    assert.equal(success(call(["docker", "volume", "ls", "--quiet", "--filter", `name=^${planned.clone}$`], undefined, 15000), "clone absence"), "");
    assert.equal(success(call(["docker", "volume", "create", "--label", "net.rockofeye.purpose=codex-provider-turn-fixture", planned.clone], undefined, 15000), "clone create"), planned.clone);
    let completed = false;
    try {
      for (const item of planned.setup) runSetup(item, directory, item.name.includes("-stage-") ? payload : undefined);
      const roleCidfile = join(directory, `${planned.role.name}.cid`);
      const command = [...planned.role.command];
      command.splice(2, 0, "--cidfile", roleCidfile);
      let roleError: unknown;
      try {
        await runClient("/usr/bin/docker", MODEL, "ROE_PILOT_CODEX_PROVIDER_AUTH_OK", 65000,
          command.slice(1), { ROE_RUNTIME_TOKEN: process.env.ROE_RUNTIME_TOKEN });
      } catch (error) { roleError = error; }
      const id = exactId(roleCidfile, planned.role.name);
      try {
        if (!roleError) {
          const state = JSON.parse(success(call(["docker", "inspect", "--type", "container", "--format", "{{json .State}}", id], undefined, 15000), "turn state")) as {
            Running: boolean; Status: string; ExitCode: number; OOMKilled: boolean;
          };
          assert.deepEqual([state.Running, state.Status, state.ExitCode, state.OOMKilled], [false, "exited", 0, false]);
        }
      } finally {
        // A credentialed container cannot be retained for routine reconciliation.
        removeExact(id, planned.role.name);
      }
      if (roleError) throw new Error(`Codex turn refused: ${safeError(roleError)}`);
      assert.equal(success(call(["docker", "volume", "rm", planned.clone], undefined, 15000), "clone removal"), planned.clone);
      assert.equal(success(call(["docker", "volume", "ls", "--quiet", "--filter", `name=^${planned.clone}$`], undefined, 15000), "clone absence"), "");
      inspectVolume(call(["docker", "volume", "inspect", "--format", "{{json .}}", state.volume], undefined, 15000), state);
      completed = true;
      process.stdout.write("PASS: one bounded Codex API-project turn; exact credentialed container and clone removed; installed state preserved; activation disabled\n");
      return 0;
    } finally {
      if (!completed) process.stdout.write(`STOP: retain private clone ${planned.clone} and reservation for reconciliation; treat clone as potentially sensitive, verify credentialed container removal, and revoke temporary key\n`);
    }
  } finally { rmSync(directory, { recursive: true, force: false }); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`CODEX_PROVIDER_GATE_REFUSED ${safeError(error)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
/** Credential-free provider egress fixture. Plan-only unless reserved --execute. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OLD = "/workspace/.ai/dotai/roles/nono-network-probe";
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const POLICY = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const IMAGE = "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
const ENGINE = { Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" };
const REQUIRED = [
  "PASS: unsandboxed direct TCP positive control",
  "PASS: direct TCP permission denied",
  "PASS: direct TCP denied after exec and proxy-variable removal",
  "PASS: api.openai.com TLS verified, CONNECT 200, unauthenticated HTTP 401",
  "PASS: unlisted example.org explicitly denied by proxy with CONNECT 403",
];

type Result = { status: number | null; stdout: string; stderr: string; error?: Error };
export type Call = (argv: string[], input?: Buffer, timeoutMs?: number) => Result;
function systemCall(argv: string[], input?: Buffer, timeoutMs = 75000): Result {
  const result = spawnSync(argv[0], argv.slice(1), {
    input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", LANG: "C",
      ROE_RUNTIME_TOKEN: process.env.ROE_RUNTIME_TOKEN },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function sources(): Record<string, string> {
  const old = JSON.parse(readFileSync(join(OLD, "bundle.json"), "utf8")) as Record<string, string>;
  return { ...old, "profile.json": join(HERE, "profile.json"),
    "entry.sh": join(HERE, "entry.sh"), "check.sh": join(HERE, "check.sh") };
}

export function verifyPins(): void {
  const pinned = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as Record<string, string>;
  const expected = [fileURLToPath(import.meta.url), join(OLD, "bundle.json"), NONO, POLICY,
    ...Object.values(sources())];
  assert.deepEqual(Object.keys(pinned).sort(), [...new Set(expected)].sort(), "pinned input set changed");
  for (const file of expected) assert.equal(sha(file), pinned[file], `pinned input changed: ${file}`);
  assert.equal(pinned[NONO], "520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9");
  const profile = JSON.parse(readFileSync(join(HERE, "profile.json"), "utf8"));
  assert.deepEqual(profile.network.allow_domain, ["api.openai.com"]);
}

export function plan(suffix: string): { name: string; command: string[] } {
  assert.match(suffix, /^[a-f0-9]{12}$/);
  const name = `roe-provider-egress-${suffix}`;
  return { name, command: ["docker", "run", "--pull=never", "--name", name,
    "--label", "net.rockofeye.purpose=provider-egress-fixture",
    "--network=bridge", "--read-only", "--user=1000:1000", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", `--security-opt=seccomp=${POLICY}`,
    "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64",
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=128m,mode=1777", "--interactive",
    "--entrypoint", "/usr/bin/timeout", IMAGE, "--signal=TERM", "--kill-after=5s",
    "60s", "/bin/sh", "-c", "mkdir /tmp/probe && tar -xf - -C /tmp/probe && exec /bin/sh /tmp/probe/entry.sh"] };
}

export function bundle(directory: string): Buffer {
  const stage = join(directory, "stage");
  mkdirSync(join(stage, "lib"), { recursive: true, mode: 0o700 });
  copyFileSync(NONO, join(stage, "nono"));
  for (const [name, source] of Object.entries(sources())) copyFileSync(source, join(stage, name));
  const archive = join(directory, "payload.tar");
  execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=1000", "--group=1000",
    "--numeric-owner", "-cf", archive, "-C", stage, "."], { timeout: 15000 });
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8", timeout: 15000 }).trim().split("\n");
  for (const name of entries) assert.ok(name.startsWith("./") && !name.split("/").includes(".."), `unsafe bundle path ${name}`);
  for (const name of ["./nono", "./curl", "./ca.pem", "./network-probe", "./profile.json", "./entry.sh", "./check.sh"])
    assert.ok(entries.includes(name), `bundle missing ${name}`);
  return readFileSync(archive);
}

function success(result: Result, label: string): string {
  assert.equal(result.error, undefined, `${label} failed to start`);
  assert.equal(result.status, 0, `${label} failed: ${(result.stdout + result.stderr).slice(0, 2000)}`);
  return result.stdout.trim();
}

export function main(argv = process.argv.slice(2), call: Call = systemCall): number {
  assert.ok(argv.length <= 1 && (argv.length === 0 || argv[0] === "--bundle-check" || argv[0] === "--execute"));
  verifyPins();
  const execute = argv[0] === "--execute";
  const planned = plan(execute ? randomUUID().replaceAll("-", "").slice(0, 12) : "000000000000");
  process.stdout.write(JSON.stringify({ executing: execute, image: IMAGE, engine: ENGINE,
    ...planned, no_host_mounts: true, no_credentials_or_model_calls: true }) + "\n");
  if (!execute && argv[0] !== "--bundle-check") return 0;
  const directory = mkdtempSync(join(tmpdir(), "roe-provider-egress-"));
  try {
    const payload = bundle(directory);
    process.stdout.write(`BUNDLE_VERIFIED bytes=${payload.length} sha256=${createHash("sha256").update(payload).digest("hex")}\n`);
    if (!execute) return 0;
    assert.ok(process.env.ROE_RUNTIME_TOKEN, "registered Firstmate reservation required");
    const server = JSON.parse(success(call(["docker", "version", "--format", "{{json .Server}}"], undefined, 15000), "engine check"));
    for (const [key, value] of Object.entries(ENGINE)) assert.equal(server[key], value, `engine ${key} changed`);
    const cidfile = join(directory, "container.cid");
    const command = [...planned.command];
    command.splice(2, 0, "--cidfile", cidfile);
    const run = call(command, payload, 75000);
    const output = (run.stdout + run.stderr).slice(0, 16000);
    process.stdout.write(output);
    let cid = "";
    try { cid = readFileSync(cidfile, "utf8").trim(); } catch { /* no container ID */ }
    if (!/^[a-f0-9]{64}$/.test(cid)) throw new Error("no exact container ID; retain reservation for reconciliation");
    process.stdout.write(`EXACT_CONTAINER_ID ${cid}\n`);
    const state = JSON.parse(success(call(["docker", "inspect", "--type", "container", "--format", "{{json .State}}", cid], undefined, 15000), "container inspect"));
    process.stdout.write(`CONTAINER_STATE ${JSON.stringify(state)}\n`);
    if (run.error || run.status !== 0 || state.Running !== false || state.Status !== "exited" ||
        state.ExitCode !== 0 || state.OOMKilled !== false)
      throw new Error(`probe failed; retain exact container ${cid} and reservation`);
    for (const line of REQUIRED) assert.ok(output.includes(line), `missing acceptance: ${line}`);
    const caps = Object.fromEntries([...output.matchAll(/^(Cap\w+):\s*([0-9a-fA-F]+)$/gm)]
      .map(match => [match[1], Number.parseInt(match[2], 16)]));
    for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
      assert.equal(caps[name], 0, `${name} was not zero`);
    assert.equal(success(call(["docker", "rm", cid], undefined, 15000), "exact container removal"), cid);
    assert.equal(success(call(["docker", "ps", "--all", "--quiet", "--filter", `name=^/${planned.name}$`], undefined, 15000), "container inventory"), "");
    process.stdout.write(`PASS: credential-free provider egress fixture; exact container ${cid} removed\n`);
    return 0;
  } finally { rmSync(directory, { recursive: true, force: false }); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.exitCode = main(); }
  catch (error) { process.stdout.write(`STOP: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

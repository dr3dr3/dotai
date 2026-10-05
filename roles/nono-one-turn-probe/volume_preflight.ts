#!/usr/bin/env node
/** Credential-free Docker file-subpath fixture. Plan-only unless --execute. */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCKER = "/usr/bin/docker";
export const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
export const ENGINE = {
  Version: "29.4.0",
  GitCommit: "daa0cb7f",
  Arch: "arm64",
} as const;
export const MARKER = "ROE_SYNTHETIC_AUTH_FILE_ONLY";
export const FIXTURE_HASH_ENV = "ROE_SYNTHETIC_FIXTURE_SHA256";

export type FixtureCommands = {
  volume: string;
  writerName: string;
  readerName: string;
  writer: string[];
  reader: string[];
};
export type CommandCall = (argv: string[], timeoutMs?: number) => string;
export type Log = (message: string) => void;
export type SignalTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
  exitCode?: string | number | null;
};
export type Schedule = (callback: () => void) => void;

export function isCompatibleNode(version: string): boolean {
  return /^22\.23\.\d+$/.test(version);
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function deferTerminationSignals(
  target: SignalTarget = process,
  schedule: Schedule = (callback) => setTimeout(callback, 50),
  log: Log = console.error,
): () => void {
  let received: NodeJS.Signals | undefined;
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      received ??= signal;
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }
  return () => {
    schedule(() => {
      for (const [signal, handler] of handlers) target.off(signal, handler);
      if (received) {
        log(
          `STOP: received ${received}; termination waited for synchronous cleanup`,
        );
        target.exitCode = 1;
      }
    });
  };
}

export function verifyFixtureMarker(
  sourcePath: string,
  environment: NodeJS.ProcessEnv,
): void {
  const expected = environment[FIXTURE_HASH_ENV];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("approved fixture hash marker required");
  }
  if (sha256(sourcePath) !== expected) {
    throw new Error(
      "running fixture SHA-256 does not match its approved marker",
    );
  }
}

export function commands(suffix: string): FixtureCommands {
  if (!/^[a-f0-9]{12}$/.test(suffix)) {
    throw new Error(
      "fixture suffix must be 12 lowercase hexadecimal characters",
    );
  }

  const volume = `roe-auth-subpath-fixture-${suffix}`;
  const writerName = `roe-auth-writer-${suffix}`;
  const readerName = `roe-auth-reader-${suffix}`;
  const base = [
    DOCKER,
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--memory=128m",
    "--memory-swap=128m",
    "--cpus=1",
    "--pids-limit=32",
  ];
  const writer = [
    ...base,
    "--cap-add=CHOWN",
    "--name",
    writerName,
    "--user=0:0",
    "--mount",
    `type=volume,src=${volume},dst=/fixture,volume-nocopy`,
    "--entrypoint",
    "/usr/bin/timeout",
    IMAGE,
    "--signal=TERM",
    "--kill-after=2s",
    "30s",
    "/bin/sh",
    "-c",
    `printf '%s' '${MARKER}' > /fixture/auth.json && printf '%s' 'SIBLING_NOT_MOUNTED' > /fixture/other.txt && chmod 0400 /fixture/auth.json && chown 1000:1000 /fixture/auth.json`,
  ];
  const reader = [
    ...base,
    "--name",
    readerName,
    "--user=1000:1000",
    "--mount",
    `type=volume,src=${volume},volume-subpath=auth.json,dst=/tmp/auth.json,readonly`,
    "--entrypoint",
    "/usr/bin/timeout",
    IMAGE,
    "--signal=TERM",
    "--kill-after=2s",
    "30s",
    "/bin/sh",
    "-c",
    `set -eu; test -f /tmp/auth.json && test -r /tmp/auth.json && test "$(cat /tmp/auth.json)" = '${MARKER}' && if chmod 0600 /tmp/auth.json 2>/dev/null; then printf '%s\\n' 'STOP: chmod unexpectedly succeeded on read-only mount' >&2; exit 42; fi && test "$(stat -c %a /tmp/auth.json)" = 400 && test ! -e /tmp/other.txt && mount_count=0 && while IFS=' ' read -r _ _ _ mountroot mountpoint mountopts _; do if test "$mountpoint" = /tmp/auth.json; then case "$mountroot" in */auth.json) ;; *) printf '%s\\n' 'STOP: mount source is not the auth.json subpath' >&2; exit 43;; esac; case ",$mountopts," in *,ro,*) ;; *) printf '%s\\n' 'STOP: exact-file mount is not read-only' >&2; exit 44;; esac; mount_count=$((mount_count + 1)); fi; done < /proc/self/mountinfo && test "$mount_count" -eq 1 && printf '%s\\n' 'PASS: one synthetic exact-file mount is readable and read-only; source subpath confirmed; sibling path absent'`,
  ];
  return { volume, writerName, readerName, writer, reader };
}

export function commandCall(argv: string[], timeoutMs = 30_000): string {
  const output = execFileSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (output) console.log(output.slice(0, 4000));
  return output;
}

export function failureText(error: unknown): string {
  const details: string[] = [];
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const text =
      typeof stderr === "string"
        ? stderr.trim()
        : Buffer.isBuffer(stderr)
          ? stderr.toString("utf8").trim()
          : "";
    if (text) details.push(text);
  }
  if (error instanceof Error && error.message) details.push(error.message);
  if (error && typeof error === "object") {
    const fields = error as {
      code?: unknown;
      status?: unknown;
      signal?: unknown;
    };
    for (const name of ["code", "status", "signal"] as const) {
      const value = fields[name];
      if (value !== undefined && value !== null && value !== "") {
        details.push(`${name}=${String(value)}`);
      }
    }
  }
  return [...new Set(details)].join("; ") || String(error);
}

function confirmsAbsent(error: unknown): boolean {
  return /no such (?:volume|container|object)/i.test(failureText(error));
}

export function cleanup(
  fixture: FixtureCommands,
  call: CommandCall,
  log: Log,
): boolean {
  for (const name of [fixture.writerName, fixture.readerName]) {
    try {
      call([DOCKER, "container", "rm", "--force", name], 15_000);
    } catch {
      // Absence is verified separately; removal is best-effort but exact-name only.
    }
  }
  try {
    call([DOCKER, "volume", "rm", "--force", fixture.volume], 15_000);
  } catch {
    // Absence is verified separately and daemon errors remain fail-closed.
  }

  let verified = true;
  for (const [kind, name] of [
    ["container", fixture.writerName],
    ["container", fixture.readerName],
    ["volume", fixture.volume],
  ] as const) {
    try {
      call([DOCKER, kind, "inspect", name], 15_000);
      log(`STOP: cleanup unverified; ${kind} still exists: ${name}`);
      verified = false;
    } catch (error) {
      if (!confirmsAbsent(error)) {
        log(
          `STOP: cleanup unverified; cannot confirm ${kind} absence: ${name}: ${failureText(error)}`,
        );
        verified = false;
      }
    }
  }
  if (verified)
    log(`CLEANUP_VERIFIED: ${fixture.volume} and named containers absent`);
  return verified;
}

export function main(
  argv = process.argv.slice(2),
  call: CommandCall = commandCall,
  nodeVersion = process.versions.node,
  environment: NodeJS.ProcessEnv = process.env,
  sourcePath = fileURLToPath(import.meta.url),
  log: Log = console.log,
): number {
  const execute = argv.includes("--execute");
  if (argv.some((argument) => argument !== "--execute")) {
    throw new Error("only --execute is accepted");
  }

  const fixture = commands(randomUUID().replaceAll("-", "").slice(0, 12));
  log(JSON.stringify({ executing: execute, ...fixture }));
  if (!execute) return 0;
  if (!isCompatibleNode(nodeVersion)) {
    throw new Error("Node must be stable 22.23.x");
  }
  verifyFixtureMarker(sourcePath, environment);
  if (!environment.ROE_RUNTIME_TOKEN) {
    throw new Error("Firstmate runtime reservation required");
  }

  const server = JSON.parse(
    call([DOCKER, "version", "--format", "{{json .Server}}"], 15_000),
  ) as unknown;
  if (
    !server ||
    typeof server !== "object" ||
    (server as Record<string, unknown>).Version !== ENGINE.Version ||
    (server as Record<string, unknown>).GitCommit !== ENGINE.GitCommit ||
    (server as Record<string, unknown>).Arch !== ENGINE.Arch
  ) {
    throw new Error("Docker engine changed; review before running");
  }

  let failed = false;
  let cleanupRequired = false;
  try {
    cleanupRequired = true;
    call(
      [
        DOCKER,
        "volume",
        "create",
        "--label",
        "net.rockofeye.purpose=synthetic-auth-subpath",
        fixture.volume,
      ],
      15_000,
    );
    call(fixture.writer, 45_000);
    call(fixture.reader, 45_000);
  } catch (error) {
    failed = true;
    log(
      `STOP: ${failureText(error)}; inspect only ${fixture.volume} and its two named containers`,
    );
  } finally {
    if (cleanupRequired && !cleanup(fixture, call, log)) failed = true;
  }

  if (failed) return 1;
  log(
    "PASS: Docker file-subpath fixture only; external ingress and egress untested",
  );
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const finishSignals = deferTerminationSignals();
  try {
    process.exitCode = main();
  } catch (error) {
    console.log(`STOP: ${failureText(error)}`);
    process.exitCode = 1;
  } finally {
    finishSignals();
  }
}

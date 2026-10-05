#!/usr/bin/env node
/** Credential-free Docker file-subpath fixture. Plan-only unless --execute. */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE =
  "sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54";
export const ENGINE = {
  Version: "29.4.0",
  GitCommit: "daa0cb7f",
  Arch: "arm64",
} as const;
export const MARKER = "ROE_SYNTHETIC_AUTH_FILE_ONLY";

export type FixtureCommands = {
  volume: string;
  writer: string[];
  reader: string[];
};
export type CommandCall = (argv: string[], timeoutMs?: number) => string;

export function isCompatibleNode(version: string): boolean {
  return /^22\.23\.\d+$/.test(version);
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
    "docker",
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
    `type=volume,src=${volume},dst=/fixture`,
    "--entrypoint",
    "/usr/bin/timeout",
    IMAGE,
    "--signal=TERM",
    "--kill-after=2s",
    "30s",
    "/bin/sh",
    "-c",
    `printf '%s' '${MARKER}' > /fixture/auth.json && printf '%s' 'SIBLING_NOT_MOUNTED' > /fixture/other.txt && chown 1000:1000 /fixture/auth.json && chmod 0400 /fixture/auth.json`,
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
    `set -eu; test -f /tmp/auth.json && test -r /tmp/auth.json && test "$(cat /tmp/auth.json)" = '${MARKER}' && if chmod 0600 /tmp/auth.json 2>/dev/null; then printf '%s\\n' 'STOP: chmod unexpectedly succeeded on read-only mount' >&2; exit 42; fi && test "$(stat -c %a /tmp/auth.json)" = 400 && test ! -e /tmp/other.txt && printf '%s\\n' 'PASS: synthetic exact-file mount readable and chmod blocked; sibling absent'`,
  ];
  return { volume, writer, reader };
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

export function main(
  argv = process.argv.slice(2),
  call: CommandCall = commandCall,
  nodeVersion = process.versions.node,
): number {
  const execute = argv.includes("--execute");
  if (argv.some((argument) => argument !== "--execute")) {
    throw new Error("only --execute is accepted");
  }

  const fixture = commands(randomUUID().replaceAll("-", "").slice(0, 12));
  console.log(JSON.stringify({ executing: execute, ...fixture }));
  if (!execute) return 0;
  if (!isCompatibleNode(nodeVersion)) {
    throw new Error("Node must be stable 22.23.x");
  }
  if (!process.env.ROE_RUNTIME_TOKEN) {
    throw new Error("Firstmate runtime reservation required");
  }

  const server = JSON.parse(
    call(["docker", "version", "--format", "{{json .Server}}"], 15_000),
  ) as Record<string, string>;
  if (
    server.Version !== ENGINE.Version ||
    server.GitCommit !== ENGINE.GitCommit ||
    server.Arch !== ENGINE.Arch
  ) {
    throw new Error("Docker engine changed; review before running");
  }

  let created = false;
  let failed = false;
  try {
    call(
      [
        "docker",
        "volume",
        "create",
        "--label",
        "net.rockofeye.purpose=synthetic-auth-subpath",
        fixture.volume,
      ],
      15_000,
    );
    created = true;
    call(fixture.writer, 45_000);
    call(fixture.reader, 45_000);
  } catch (error) {
    failed = true;
    console.log(
      `STOP: ${error instanceof Error ? error.message : String(error)}; inspect only ${fixture.volume} and its two named containers`,
    );
  } finally {
    if (created) {
      try {
        call(["docker", "volume", "rm", fixture.volume], 15_000);
        console.log(`CLEANUP_VERIFIED: ${fixture.volume} removed`);
      } catch (error) {
        failed = true;
        console.log(
          `STOP: exact-volume cleanup unverified: ${error instanceof Error ? error.message : String(error)}; retain reservation`,
        );
      }
    }
  }

  if (failed) return 1;
  console.log(
    "PASS: Docker file-subpath fixture only; external ingress and egress untested",
  );
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.log(
      `STOP: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

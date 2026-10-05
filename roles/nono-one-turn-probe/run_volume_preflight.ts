#!/usr/bin/env node
/** Hash-pinned operator route for the synthetic file-subpath fixture. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK = "ai-auth-file-subpath-preflight-20261005";
const HOME = "/workspace/.firstmate-home";
const FIXTURE = join(HERE, "volume_preflight.ts");
const APPROVED = new Map<string, string>([
  [
    "volume_preflight.ts",
    "3527b150d1771702d13f382c28143d810c510543a9714d5a2346a92a523c820b",
  ],
  [
    "test_volume_preflight.ts",
    "920de1f0ede5735f86245de66e8874385610bccc452b11d8c71bdf2e82f0f27c",
  ],
  [
    "PREFLIGHT-TASK-TS.md",
    "095a15797d75cfe0f84f26abd67569daf249c1bb54bce7cde39d28035a1571ff",
  ],
]);

export type SpawnCall = (
  file: string,
  args: string[],
) => { status: number | null; signal?: NodeJS.Signals | null; error?: Error };

export function isCompatibleOperatorNode(version: string): boolean {
  return /^22\.23\.\d+$/.test(version);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyApprovedSources(): void {
  for (const [name, expected] of APPROVED) {
    const actual = sha256(join(HERE, name));
    if (actual !== expected) {
      throw new Error(
        `${name} SHA-256 changed; review and replace the request`,
      );
    }
  }
}

export function main(
  argv = process.argv.slice(2),
  spawn: SpawnCall = spawnSync,
  nodeVersion = process.versions.node,
): number {
  if (argv.some((argument) => argument !== "--execute")) {
    throw new Error("only --execute is accepted");
  }
  if (!isCompatibleOperatorNode(nodeVersion)) {
    throw new Error("Node must be stable 22.23.x");
  }
  verifyApprovedSources();

  const command = [
    "run",
    "--home",
    HOME,
    "--task",
    TASK,
    "--",
    process.execPath,
    FIXTURE,
    "--execute",
  ];
  if (!argv.includes("--execute")) {
    console.log(JSON.stringify({ executing: false, command }));
    return 0;
  }

  const result = spawn("roe-coordination", command);
  if (result.error) throw result.error;
  if (result.signal || result.status === null) {
    throw new Error("coordination execution did not return an exit code");
  }
  return result.status;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(
      `STOP: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

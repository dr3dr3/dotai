#!/usr/bin/env node
/** Hash-pinned operator entry point for TypeScript Pilot prepare and doctor. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  inertProfile,
  main as roleMain,
  statePlan,
  verifyNativeCodex,
} from "../../scripts/roe-role.ts";
import { operationPlan, verifyPolicy } from "../../scripts/roe-role-state.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOTAI = resolve(HERE, "../..");
const BASE_COMMIT = "b3d9cf811b9770e9fde03a50b9ec1a888a6c4142";
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const SECCOMP = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const SHA256 = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export function verifyInputs(): void {
  execFileSync("git", [
    "-C",
    DOTAI,
    "merge-base",
    "--is-ancestor",
    BASE_COMMIT,
    "HEAD",
  ]);
  const pins = JSON.parse(readFileSync(join(HERE, "pins.json"), "utf8")) as {
    files: Record<string, string>;
  };
  const files = [
    fileURLToPath(import.meta.url),
    resolve(HERE, "../../scripts/roe-role.ts"),
    resolve(HERE, "../../scripts/roe-role-state.ts"),
    resolve(HERE, "../catalogue.json"),
    resolve(HERE, "../codex-runtime.json"),
    NONO,
    SECCOMP,
  ];
  assert.deepEqual(Object.keys(pins.files).sort(), files.sort());
  for (const file of files)
    assert.equal(
      SHA256(file),
      pins.files[file],
      `pinned input changed: ${file}`,
    );
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  assert.ok(
    args.length === 0 ||
      (args.length === 1 &&
        ["--plan", "--prepare", "--doctor"].includes(args[0])),
    "choose --plan, --prepare or --doctor",
  );
  verifyInputs();
  const mode = args[0] ?? "--plan";
  const plan = statePlan("pilot", "codex");
  verifyPolicy(inertProfile("pilot", "codex"));
  const native = await verifyNativeCodex();
  if (mode === "--plan") {
    process.stdout.write(
      JSON.stringify({
        mode: "plan-only",
        native,
        prepare: operationPlan("prepare", plan, "000000000000"),
        doctor: operationPlan("doctor", plan, "000000000000"),
        credentials: false,
        model_calls: false,
        role_activation: "disabled",
      }) + "\n",
    );
    return 0;
  }
  assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
  return roleMain([
    mode === "--prepare" ? "prepare" : "doctor",
    "pilot",
    "--harness",
    "codex",
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `role-prepare-doctor: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}

#!/usr/bin/env node
/** Narrow read-only Doctor retry after the sealed-volume listing refusal. */
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
const BASE_COMMIT = "406add9f92abe9a81d1e6d6e0a6655dd3c1feb00";
const NONO = "/home/vscode/.local/lib/roe-firstmate/nono";
const SECCOMP = "/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json";
const sha256 = (file: string) =>
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
      sha256(file),
      pins.files[file],
      `pinned input changed: ${file}`,
    );
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  assert.ok(
    args.length === 0 ||
      (args.length === 1 && ["--plan", "--doctor"].includes(args[0])),
    "choose --plan or --doctor; preparation cannot be retried here",
  );
  verifyInputs();
  const plan = statePlan("pilot", "codex");
  verifyPolicy(inertProfile("pilot", "codex"));
  const native = await verifyNativeCodex();
  if (!args.length || args[0] === "--plan") {
    process.stdout.write(
      JSON.stringify({
        mode: "plan-only",
        native,
        doctor: operationPlan("doctor", plan, "000000000000"),
        prepare_allowed: false,
        role_activation: "disabled",
      }) + "\n",
    );
    return 0;
  }
  assert.ok(process.env.ROE_RUNTIME_TOKEN, "Firstmate reservation required");
  return roleMain(["doctor", "pilot", "--harness", "codex"]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `role-state-doctor-repair: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}

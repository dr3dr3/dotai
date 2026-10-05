#!/usr/bin/env node
/** Hash-pinned operator route for the synthetic file-subpath fixture. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK = "ai-auth-file-subpath-preflight-20261005";
const HOME = "/workspace/.firstmate-home";
const COORDINATION = "/home/vscode/.local/bin/roe-coordination";
const FIXTURE_NAME = "volume_preflight.ts";
const FIXTURE = join(HERE, FIXTURE_NAME);
const HASH_MARKER = "ROE_SYNTHETIC_FIXTURE_SHA256";
const APPROVED = new Map<string, string>([
  [
    FIXTURE_NAME,
    "a5abb5859b38f8ef489d3c29378149bb65560210b556ec2966b37d4789877d6d",
  ],
  [
    "test_volume_preflight.ts",
    "5fe8cd8a90f71cb98fd1109f58b8c143c56c7dd9fd7c4887bdda872fa4edd332",
  ],
  [
    "PREFLIGHT-TASK-TS.md",
    "5534037438a6daa250893865fd4485b34f998b552e9894a593dc409836b9d424",
  ],
]);

type SignalTarget = {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
  exitCode?: string | number | null;
};
type Schedule = (callback: () => void) => void;

export type SpawnOptions = {
  stdio: "inherit";
  env: NodeJS.ProcessEnv;
};
export type SpawnCall = (
  file: string,
  args: string[],
  options: SpawnOptions,
) => { status: number | null; signal?: NodeJS.Signals | null; error?: Error };

export function isCompatibleOperatorNode(version: string): boolean {
  return /^22\.23\.\d+$/.test(version);
}

export function deferWrapperTerminationSignals(
  target: SignalTarget = process,
  schedule: Schedule = (callback) => setTimeout(callback, 50),
  log: (message: string) => void = console.error,
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
          `STOP: received ${received}; termination waited for wrapper cleanup`,
        );
        target.exitCode = 1;
      }
    });
  };
}

export function verifyBootstrap(
  environment: NodeJS.ProcessEnv = process.env,
  execArgv = process.execArgv,
): void {
  if (environment.NODE_OPTIONS || environment.NODE_PATH) {
    throw new Error("Node injection environment must be empty");
  }
  if (
    execArgv.some((argument) =>
      /^(?:-r$|--require(?:=|$)|--import(?:=|$)|--loader(?:=|$)|--experimental-loader(?:=|$))/.test(
        argument,
      ),
    )
  ) {
    throw new Error("Node preload and loader arguments are forbidden");
  }
}

function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyApprovedSources(
  read: (path: string) => Buffer = (path) => readFileSync(path),
): void {
  for (const [name, expected] of APPROVED) {
    const actual = digest(read(join(HERE, name)));
    if (actual !== expected) {
      throw new Error(
        `${name} SHA-256 changed; review and replace the request`,
      );
    }
  }
}

export function cleanEnvironment(
  fixtureHash = APPROVED.get(FIXTURE_NAME) ?? "",
): NodeJS.ProcessEnv {
  return {
    HOME: "/home/vscode",
    USER: "vscode",
    LOGNAME: "vscode",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/home/vscode/.local/bin:/usr/local/bin:/usr/bin:/bin",
    TMPDIR: "/tmp",
    [HASH_MARKER]: fixtureHash,
  };
}

function snapshotFixture(): { directory: string; path: string } {
  const content = readFileSync(FIXTURE);
  const expected = APPROVED.get(FIXTURE_NAME);
  if (!expected || digest(content) !== expected) {
    throw new Error("fixture changed before snapshot; replace the request");
  }
  const directory = mkdtempSync(join(tmpdir(), "roe-auth-subpath-approved-"));
  try {
    const path = join(directory, basename(FIXTURE));
    writeFileSync(path, content, { mode: 0o500, flag: "wx" });
    chmodSync(directory, 0o700);
    if (digest(readFileSync(path)) !== expected) {
      throw new Error("fixture snapshot verification failed");
    }
    return { directory, path };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
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
  verifyBootstrap();
  if (!isCompatibleOperatorNode(nodeVersion)) {
    throw new Error("Node must be stable 22.23.x");
  }
  verifyApprovedSources();

  if (!argv.includes("--execute")) {
    console.log(
      JSON.stringify({
        executing: false,
        task: TASK,
        home: HOME,
        fixture_sha256: APPROVED.get(FIXTURE_NAME),
      }),
    );
    return 0;
  }

  const snapshot = snapshotFixture();
  try {
    const command = [
      "run",
      "--home",
      HOME,
      "--task",
      TASK,
      "--",
      process.execPath,
      snapshot.path,
      "--execute",
    ];
    const result = spawn(COORDINATION, command, {
      stdio: "inherit",
      env: cleanEnvironment(),
    });
    if (result.error) throw result.error;
    if (result.signal || result.status === null) {
      throw new Error("coordination execution did not return an exit code");
    }
    return result.status;
  } finally {
    rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const finishSignals = deferWrapperTerminationSignals();
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(
      `STOP: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    finishSignals();
  }
}

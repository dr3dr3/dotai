#!/usr/bin/env node
// Resolve the configured local Firstmate captain home without creating or
// claiming it. The harness calls this before nono for a recognised captain cwd
// and exports the printed path as FM_HOME; Firstmate startup still owns the
// home's lock.
//
// The production roots are fixed constants. They are deliberately NOT read
// from the environment: an override would let any caller redirect the
// authority root a captain runs under. Unit tests inject roots through the
// exported function parameters instead. The only environment input is the
// caller's candidate FM_HOME, which must resolve to the configured home.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CONFIGURED_HOME = "/workspace/.firstmate-home";
export const REGISTRY_PATH = "/workspace/.git/roe-runtime.json";
const REQUIRED_DIRECTORIES = ["config", "data", "state"];
const DIAGNOSTIC_LIMIT = 200;

class CaptainHomeError extends Error {}

function strictPath(path: string, what: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw new CaptainHomeError(`${what} does not exist`);
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function registeredHomes(registry: string): string[] {
  let text: string;
  try {
    text = readFileSync(registry, "utf8");
  } catch {
    throw new CaptainHomeError("runtime registry is unreadable");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CaptainHomeError("runtime registry is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new CaptainHomeError("runtime registry is not a JSON object");
  }
  const record = data as { version?: unknown; homes?: unknown };
  if (record.version !== 1) {
    throw new CaptainHomeError("runtime registry version is not 1");
  }
  const homes = record.homes;
  if (
    !Array.isArray(homes) ||
    !homes.every((home) => typeof home === "string")
  ) {
    throw new CaptainHomeError("runtime registry homes must be a path array");
  }
  return homes as string[];
}

export function resolveHome(
  supplied: string | undefined,
  registry: string = REGISTRY_PATH,
  configured: string = CONFIGURED_HOME,
): string {
  const expected = strictPath(configured, "configured captain home");
  const selected = supplied
    ? strictPath(supplied, "captain FM_HOME")
    : expected;
  if (selected !== expected) {
    throw new CaptainHomeError(
      "captain FM_HOME differs from the configured local stack home",
    );
  }
  if (!registeredHomes(registry).includes(expected)) {
    throw new CaptainHomeError(
      "configured captain home is not registered for runtime coordination",
    );
  }
  const missing = REQUIRED_DIRECTORIES.filter(
    (part) => !isDirectory(`${expected}/${part}`),
  );
  if (missing.length > 0) {
    throw new CaptainHomeError(
      `configured captain home is not initialised (missing ${missing.join(", ")}); refusing to create it`,
    );
  }
  return expected;
}

function bounded(message: string): string {
  const single = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return single.length > DIAGNOSTIC_LIMIT
    ? `${single.slice(0, DIAGNOSTIC_LIMIT - 1)}…`
    : single;
}

export function main(
  env: { FM_HOME?: string } = process.env,
  out: (text: string) => void = (text) => process.stdout.write(text),
  err: (text: string) => void = (text) => process.stderr.write(text),
  registry: string = REGISTRY_PATH,
  configured: string = CONFIGURED_HOME,
): number {
  try {
    out(`${resolveHome(env.FM_HOME, registry, configured)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof CaptainHomeError
        ? error.message
        : "unexpected failure while resolving the captain home";
    err(`firstmate-captain-home: ${bounded(message)}\n`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}

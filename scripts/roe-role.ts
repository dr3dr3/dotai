#!/usr/bin/env node
/** TypeScript role launcher candidate. All stateful actions remain disabled. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGUE = join(SOURCE, "roles/catalogue.json");
const CODEX_PIN = join(SOURCE, "roles/codex-runtime.json");
const CATALOGUE_SHA256 =
  "a2ee6fe05113147028da6d67e9c5b0df4534b1b67f7082dba354d5ff9d2fbd54";
const CODEX_PIN_SHA256 =
  "f8050709119d8fdd5ec3625dc948a13edb07e015d2e6f471556db1513e2c65e5";
const ACTIVATION_BLOCKER =
  "activation disabled: installed private state, provider/auth and safe restore remain unverified";
const HARNESSES = ["codex", "claude", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

type Role = { title: string; workspace: string; tab: string; purpose: string };
type Catalogue = {
  schema_version: number;
  charter: string;
  roles: Record<string, Role>;
};
type NativePin = {
  schema_version: number;
  platform: string;
  machine: string;
  version: string;
  path: string;
  sha256: string;
};

function catalogue(): Catalogue {
  const contents = readFileSync(CATALOGUE);
  assert.equal(
    createHash("sha256").update(contents).digest("hex"),
    CATALOGUE_SHA256,
    "role catalogue changed; review before re-pin",
  );
  const value = JSON.parse(contents.toString("utf8")) as Catalogue;
  assert.equal(value.schema_version, 1, "unsupported role catalogue");
  return value;
}

export function roleRecord(role: string): Role {
  assert.match(role, /^[a-z][a-z0-9-]*$/, "invalid role ID");
  const record = catalogue().roles[role];
  assert.ok(record, `unknown role ${role}`);
  return record;
}

export function harnessStatus(name: string): {
  harness: Harness;
  status: "candidate" | "unverified";
  activation: "disabled";
  missing_checks: string[];
} {
  assert.ok(HARNESSES.includes(name as Harness), `unknown harness ${name}`);
  const harness = name as Harness;
  return harness === "codex"
    ? {
        harness,
        status: "candidate",
        activation: "disabled",
        missing_checks: [
          "installed private state",
          "provider authentication and bounded inference",
          "exact native transcript resume",
          "safe Herdr restore",
        ],
      }
    : {
        harness,
        status: "unverified",
        activation: "disabled",
        missing_checks: [
          "native executable pin",
          "private state and authentication",
          "instruction loading",
          "filesystem/network/socket boundaries",
          "provider session identity and resume",
        ],
      };
}

export async function verifyNativeCodex(pinPath = CODEX_PIN): Promise<{
  version: string;
  path: string;
  sha256: string;
}> {
  const pinContents = readFileSync(pinPath);
  if (pinPath === CODEX_PIN)
    assert.equal(
      createHash("sha256").update(pinContents).digest("hex"),
      CODEX_PIN_SHA256,
      "Codex runtime pin changed; review before re-pin",
    );
  const pin = JSON.parse(pinContents.toString("utf8")) as NativePin;
  assert.equal(pin.schema_version, 1, "unsupported Codex pin");
  assert.equal(pin.platform, process.platform, "Codex platform changed");
  assert.equal(
    pin.machine,
    process.arch === "arm64" ? "aarch64" : process.arch,
    "Codex architecture changed",
  );
  assert.ok(pin.path.startsWith("/"), "Codex path must be absolute");
  const info = statSync(pin.path, { throwIfNoEntry: false });
  assert.ok(
    info?.isFile() && (info.mode & 0o111) !== 0,
    "reviewed native Codex executable missing",
  );
  const fd = openSync(pin.path, "r");
  const magic = Buffer.alloc(4);
  try {
    assert.equal(
      readSync(fd, magic, 0, 4, 0),
      4,
      "Codex executable is truncated",
    );
  } finally {
    closeSync(fd);
  }
  assert.deepEqual(
    magic,
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    "Codex must be native ELF",
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(pin.path)) hash.update(chunk);
  const digest = hash.digest("hex");
  assert.equal(
    digest,
    pin.sha256,
    "Codex binary changed; review exact binary before re-pin",
  );
  return { version: pin.version, path: pin.path, sha256: digest };
}

export function statePlan(
  role: string,
  harness: string,
): {
  role: "pilot";
  harness: "codex";
  status: "plan-only";
  volume: string;
  labels: Record<string, string>;
  mount: string;
  role_directory: string;
  home: string;
  continuity_db: string;
  uid: "1000:1000";
  policy_location: "trusted launcher outside role volume";
  activation: "disabled";
} {
  roleRecord(role);
  harnessStatus(harness);
  assert.equal(role, "pilot", "state plan accepted only for pilot role");
  assert.equal(
    harness,
    "codex",
    `${harness} adapter is unverified; no Codex substitution`,
  );
  const volume = "roe-role-pilot-state-v1";
  return {
    role: "pilot",
    harness: "codex",
    status: "plan-only",
    volume,
    labels: {
      "net.rockofeye.purpose": "personal-advisory-role-state",
      "net.rockofeye.role": "pilot",
      "net.rockofeye.contract": "typescript-continuity-v1",
    },
    mount: `type=volume,src=${volume},dst=/state,volume-nocopy`,
    role_directory: "/state/pilot",
    home: "/state/pilot/home",
    continuity_db: "/state/pilot/continuity/continuity.sqlite3",
    uid: "1000:1000",
    policy_location: "trusted launcher outside role volume",
    activation: "disabled",
  };
}

/** Credential-free boundary fixture. It is not the provider launch profile. */
export function inertProfile(role: string, harness: string): object {
  const state = statePlan(role, harness);
  return {
    meta: { name: "roe-pilot-inert", version: "1.0.0" },
    workdir: { access: "read" },
    security: {
      signal_mode: "isolated",
      process_info_mode: "isolated",
      ipc_mode: "shared_memory_only",
      capability_elevation: false,
    },
    linux: { af_unix_mediation: "pathname" },
    filesystem: {
      read: ["/tmp/probe/context"],
      read_file: [
        "/tmp/probe/check.sh",
        `${state.role_directory}/instructions.md`,
      ],
      allow: [
        `${state.role_directory}/continuity`,
        `${state.role_directory}/output`,
        `${state.home}/.codex`,
        `${state.home}/.config/roe-advisor`,
        `${state.home}/.cache/roe-advisor`,
        `${state.home}/.local/state/roe-advisor`,
        `${state.role_directory}/tmp`,
      ],
      unix_socket_subtree_bind: [`${state.home}/.codex`],
    },
    network: { allow_domain: [] },
    environment: {
      allow_vars: [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "TMPDIR",
        "XDG_*",
        "CODEX_HOME",
      ],
      deny_vars: [
        "*_TOKEN",
        "*_SECRET",
        "*_API_KEY",
        "HERDR_*",
        "FM_*",
        "SSH_*",
        "AWS_*",
        "GH_*",
        "GITHUB_*",
        "OP_*",
        "NODE_OPTIONS",
        "PYTHONPATH",
      ],
    },
  };
}

type Parsed = {
  action: string;
  role?: string;
  harness?: string;
  resume: boolean;
};

export function parse(args: string[]): Parsed {
  assert.ok(
    args.length > 0,
    "usage: roe-role ACTION [ROLE] [--harness codex|claude|pi]",
  );
  const [action, ...rest] = args;
  const positional: string[] = [];
  let harness: string | undefined;
  let resume = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--harness") {
      assert.ok(!harness && rest[i + 1], "--harness needs one value");
      harness = rest[++i];
    } else if (rest[i] === "--resume") {
      assert.equal(resume, false, "duplicate --resume");
      resume = true;
    } else {
      assert.ok(!rest[i].startsWith("-"), `unknown option ${rest[i]}`);
      positional.push(rest[i]);
    }
  }
  assert.ok(positional.length <= 1, "one role ID expected");
  return { action, role: positional[0], harness, resume };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const parsed = parse(args);
  const { action, role, harness, resume } = parsed;
  if (action === "list") {
    assert.ok(!role && !harness && !resume, "list accepts no role or options");
    for (const [id, record] of Object.entries(catalogue().roles))
      process.stdout.write(`${id}\t${record.title}\n`);
    return 0;
  }
  if (action === "harnesses") {
    assert.ok(
      !role && !harness && !resume,
      "harnesses accepts no role or options",
    );
    process.stdout.write(JSON.stringify(HARNESSES.map(harnessStatus)) + "\n");
    return 0;
  }
  assert.ok(role && harness, "explicit role and --harness required");
  roleRecord(role);
  const status = harnessStatus(harness);
  assert.equal(
    resume,
    false,
    "native resume requires verified exact session binding",
  );
  if (action === "inspect") {
    process.stdout.write(
      JSON.stringify({ role, ...roleRecord(role), adapter: status }) + "\n",
    );
    return 0;
  }
  if (action === "plan-state") {
    await verifyNativeCodex();
    process.stdout.write(JSON.stringify(statePlan(role, harness)) + "\n");
    return 0;
  }
  assert.ok(
    ["prepare", "doctor", "run"].includes(action),
    `unknown action ${action}`,
  );
  throw new Error(
    `${ACTIVATION_BLOCKER}; ${status.harness} ${status.status}; no state change`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `roe-role: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}

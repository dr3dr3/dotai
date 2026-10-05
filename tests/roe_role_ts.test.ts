import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  harnessStatus,
  inertProfile,
  main,
  parse,
  roleRecord,
  statePlan,
  verifyNativeCodex,
} from "../scripts/roe-role.ts";

test("private role state plan names one pilot volume and no host mount", () => {
  const planned = statePlan("pilot", "codex");
  assert.equal(planned.status, "plan-only");
  assert.equal(planned.activation, "disabled");
  assert.equal(planned.volume, "roe-role-pilot-state-v1");
  assert.equal(
    planned.mount,
    "type=volume,src=roe-role-pilot-state-v1,dst=/state,volume-nocopy",
  );
  assert.equal(planned.role_directory, "/state/pilot");
  assert.equal(planned.home, "/state/pilot/home");
  assert.equal(
    planned.continuity_db,
    "/state/pilot/continuity/continuity.sqlite3",
  );
  assert.ok(!JSON.stringify(planned).includes("type=bind"));
  assert.ok(!JSON.stringify(planned).includes("docker.sock"));
  assert.ok(!JSON.stringify(planned).includes("herdr.sock"));
});

test("inert profile binds only planned pilot subdirectories", () => {
  const profile = inertProfile("pilot", "codex") as {
    filesystem: { allow: string[] };
    network: { allow_domain: string[] };
  };
  assert.deepEqual(profile.network.allow_domain, []);
  assert.ok(profile.filesystem.allow.includes("/state/pilot/continuity"));
  assert.ok(profile.filesystem.allow.includes("/state/pilot/home/.codex"));
  assert.ok(!profile.filesystem.allow.includes("/state/pilot"));
  assert.ok(!profile.filesystem.allow.includes("/state/pilot/home"));
  assert.ok(!JSON.stringify(profile).includes("/workspace"));
  assert.ok(!JSON.stringify(profile).includes("auth.json"));
  for (const harness of ["claude", "pi"])
    assert.throws(() => inertProfile("pilot", harness), /unverified/);
});

test("Claude and Pi are independently unverified and never mapped to Codex state", () => {
  for (const harness of ["claude", "pi"]) {
    assert.equal(harnessStatus(harness).status, "unverified");
    assert.throws(
      () => statePlan("pilot", harness),
      /adapter is unverified; no Codex substitution/,
    );
  }
  assert.equal(harnessStatus("codex").status, "candidate");
});

test("unknown roles and missing explicit harness refuse", async () => {
  assert.throws(() => roleRecord("not-a-role"), /unknown role/);
  assert.throws(() => statePlan("not-a-role", "codex"), /unknown role/);
  assert.deepEqual(parse(["run", "pilot", "--harness", "codex"]), {
    action: "run",
    role: "pilot",
    harness: "codex",
    resume: false,
  });
  await assert.rejects(
    main(["run", "pilot"]),
    /explicit role and --harness required/,
  );
  await assert.rejects(
    main(["run", "pilot", "--harness", "codex", "--resume"]),
    /verified exact session binding/,
  );
});

test("all operational actions refuse before state creation", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "roe-role-ts-refusal-"));
  const previousHome = process.env.HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.HOME = scratch;
  process.env.XDG_STATE_HOME = join(scratch, "state");
  try {
    for (const harness of ["codex", "claude", "pi"])
      for (const action of ["prepare", "doctor", "run"])
        await assert.rejects(
          main([action, "pilot", "--harness", harness]),
          /activation disabled/,
        );
    assert.equal(existsSync(join(scratch, ".local/state/roe-roles")), false);
    assert.equal(existsSync(join(scratch, "state")), false);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(scratch, { recursive: true });
  }
});

test("native Codex pin verifies ELF and digest, refusing changed binary", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "roe-role-ts-pin-"));
  try {
    const binary = join(scratch, "codex");
    const pinPath = join(scratch, "pin.json");
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]);
    writeFileSync(binary, bytes, { mode: 0o700 });
    const pin = {
      schema_version: 1,
      platform: process.platform,
      machine: process.arch === "arm64" ? "aarch64" : process.arch,
      version: "fixture",
      path: binary,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    writeFileSync(pinPath, JSON.stringify(pin));
    assert.equal((await verifyNativeCodex(pinPath)).sha256, pin.sha256);
    writeFileSync(binary, Buffer.concat([bytes, Buffer.from([4])]), {
      mode: 0o700,
    });
    await assert.rejects(verifyNativeCodex(pinPath), /binary changed/);
    writeFileSync(binary, Buffer.from("wrapper"), { mode: 0o700 });
    await assert.rejects(verifyNativeCodex(pinPath), /native ELF/);
  } finally {
    rmSync(scratch, { recursive: true });
  }
});

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { inertProfile, statePlan } from "../scripts/roe-role.ts";
import {
  inspectVolume,
  operate,
  operationPlan,
  verifyPolicy,
  type Call,
} from "../scripts/roe-role-state.ts";

const plan = statePlan("pilot", "codex");
const profile = inertProfile("pilot", "codex");
const labels = plan.labels;

function fakeDocker(options: { foreign?: boolean; failPhase?: string } = {}) {
  let volume = false;
  let nextCid = 1;
  const calls: string[][] = [];
  const phases: string[] = [];
  const result = (stdout = "", status = 0) => ({ status, stdout, stderr: "" });
  const call: Call = (argv) => {
    calls.push(argv);
    if (argv[1] === "version")
      return result(
        JSON.stringify({
          Version: "29.4.0",
          GitCommit: "daa0cb7f",
          Arch: "arm64",
        }),
      );
    if (argv[1] === "volume" && argv[2] === "ls")
      return result(volume ? `${plan.volume}\n` : "");
    if (argv[1] === "volume" && argv[2] === "create") {
      volume = true;
      return result(`${plan.volume}\n`);
    }
    if (argv[1] === "volume" && argv[2] === "inspect")
      return result(
        JSON.stringify({
          Name: plan.volume,
          Driver: options.foreign ? "remote" : "local",
          Scope: "local",
          Labels: labels,
          Options: null,
        }),
      );
    if (argv[1] === "run") {
      const name = argv[argv.indexOf("--name") + 1];
      const phase = name.split("-").at(-2)!;
      phases.push(phase);
      writeFileSync(
        argv[argv.indexOf("--cidfile") + 1],
        String(nextCid++).padStart(64, "0"),
      );
      const marker =
        phase === "prepare"
          ? "STATE_PREPARED\n"
          : phase === "doctor"
            ? "STATE_DOCTOR_OK\n"
            : "";
      return result(marker, phase === options.failPhase ? 1 : 0);
    }
    if (argv[1] === "inspect")
      return result(
        JSON.stringify({
          Running: false,
          Status: "exited",
          ExitCode: 0,
          OOMKilled: false,
        }),
      );
    if (argv[1] === "logs" || argv[1] === "ps") return result();
    if (argv[1] === "rm") return result(`${argv[2]}\n`);
    throw new Error(`unexpected call ${argv.join(" ")}`);
  };
  return { call, calls, phases, exists: () => volume };
}

test("prepare and doctor plan only mount the private role volume", () => {
  verifyPolicy(profile);
  for (const mode of ["prepare", "doctor"] as const) {
    const planned = operationPlan(mode, plan, "abcdef123456");
    assert.equal(planned.volume, "roe-role-pilot-state-v1");
    assert.equal(planned.containers.length, mode === "prepare" ? 4 : 1);
    for (const item of planned.containers) {
      assert.equal(
        item.command.filter((value) => value === "--mount").length,
        1,
      );
      assert.ok(item.command.includes("--network=none"));
      assert.ok(item.command.includes("--read-only"));
      assert.ok(item.command.includes("--cap-drop=ALL"));
      assert.ok(item.command.includes("--security-opt=no-new-privileges=true"));
      assert.ok(
        !item.command.some((value) =>
          /type=bind|docker\.sock|herdr\.sock|\/workspace\/ai-context|\/home\/vscode/.test(
            value,
          ),
        ),
      );
      if (item.name.includes("-doctor-"))
        assert.ok(item.command.includes(`${plan.mount},readonly`));
    }
  }
});

test("prepare and doctor refuse without a reservation before any Docker call", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  delete process.env.ROE_RUNTIME_TOKEN;
  try {
    for (const mode of ["prepare", "doctor"] as const) {
      let calls = 0;
      assert.throws(
        () =>
          operate(mode, plan, profile, () => {
            calls++;
            throw new Error("Docker called");
          }),
        /Firstmate reservation required/,
      );
      assert.equal(calls, 0);
    }
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("new role state remains installed; doctor uses a fresh read-only container", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  const fake = fakeDocker();
  try {
    operate("prepare", plan, profile, fake.call);
    assert.equal(fake.exists(), true);
    assert.deepEqual(fake.phases, ["init", "prepare", "seal", "doctor"]);
    operate("doctor", plan, profile, fake.call);
    assert.deepEqual(fake.phases, [
      "init",
      "prepare",
      "seal",
      "doctor",
      "doctor",
    ]);
    assert.equal(
      fake.calls.filter((argv) => argv[1] === "volume" && argv[2] === "create")
        .length,
      1,
    );
    assert.equal(fake.calls.filter((argv) => argv[1] === "rm").length, 5);
    assert.equal(
      fake.calls.filter((argv) => argv[1] === "volume" && argv[2] === "rm")
        .length,
      0,
    );
    operate("prepare", plan, profile, fake.call);
    assert.deepEqual(fake.phases.at(-1), "doctor");
    assert.equal(
      fake.calls.filter((argv) => argv[1] === "volume" && argv[2] === "create")
        .length,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("doctor refuses a missing volume and foreign volume metadata", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  try {
    const missing = fakeDocker();
    assert.throws(
      () => operate("doctor", plan, profile, missing.call),
      /volume missing/,
    );
    assert.equal(missing.phases.length, 0);
    assert.throws(() =>
      inspectVolume(
        {
          status: 0,
          stdout: JSON.stringify({
            Name: plan.volume,
            Driver: "remote",
            Scope: "local",
            Labels: labels,
            Options: null,
          }),
          stderr: "",
        },
        plan,
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("failed preparation retains the exact volume and skips seal/doctor", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  const fake = fakeDocker({ failPhase: "prepare" });
  try {
    assert.throws(
      () => operate("prepare", plan, profile, fake.call),
      /container failed/,
    );
    assert.equal(fake.exists(), true);
    assert.deepEqual(fake.phases, ["init", "prepare"]);
    assert.ok(
      !fake.calls.some((argv) => argv[1] === "volume" && argv[2] === "rm"),
    );
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

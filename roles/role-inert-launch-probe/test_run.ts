import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { checkVolumeInspection, main, plan } from "./run.ts";

const labels = {
  "net.rockofeye.purpose": "personal-advisory-role-state",
  "net.rockofeye.role": "pilot",
  "net.rockofeye.contract": "typescript-continuity-v1",
};

test("inert plan binds only one private role volume and exact policy", () => {
  const planned = plan("abcdef123456");
  assert.equal(planned.volume, "roe-role-pilot-state-v1");
  assert.deepEqual(planned.labels, labels);
  for (const item of Object.values(planned.containers)) {
    assert.equal(item.command.filter((value) => value === "--mount").length, 1);
    assert.ok(item.command.includes(planned.mount));
    for (const option of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges=true",
      "--pull=never",
    ])
      assert.ok(item.command.includes(option));
    assert.ok(
      !item.command.some((value) =>
        /type=bind|docker\.sock|herdr\.sock|\/workspace\/ai-context|\/home\/vscode/.test(
          value,
        ),
      ),
    );
  }
  assert.ok(
    planned.containers.inert.command.includes(
      "--security-opt=seccomp=/workspace/tmp/ai-pilot-nono-seccomp/pidfd-only.json",
    ),
  );
  assert.ok(planned.containers.inert.command.includes("--user=1000:1000"));
});

test("foreign volume metadata refuses", () => {
  const planned = plan("abcdef123456");
  const record = (overrides: object) => ({
    status: 0,
    stderr: "",
    stdout: JSON.stringify({
      Name: planned.volume,
      Driver: "local",
      Scope: "local",
      Labels: labels,
      Options: null,
      ...overrides,
    }),
  });
  checkVolumeInspection(record({}), planned);
  assert.throws(() =>
    checkVolumeInspection(record({ Driver: "remote" }), planned),
  );
  assert.throws(() =>
    checkVolumeInspection(
      record({ Labels: { ...labels, role: "other" } }),
      planned,
    ),
  );
  assert.throws(
    () =>
      checkVolumeInspection(
        record({ Options: { device: "/workspace" } }),
        planned,
      ),
    /options/,
  );
});

test("missing reservation refuses before any Docker call", async () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  delete process.env.ROE_RUNTIME_TOKEN;
  let calls = 0;
  try {
    await assert.rejects(
      main(["--execute"], () => {
        calls++;
        throw new Error("Docker called");
      }),
      /registered Firstmate reservation required/,
    );
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("successful fake run checks denials and removes only exact resources", async () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  let volumeExists = false;
  let runCount = 0;
  const calls: string[][] = [];
  const result = (stdout = "", status = 0) => ({ status, stdout, stderr: "" });
  const call = (argv: string[]) => {
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
      return result(volumeExists ? "roe-role-pilot-state-v1\n" : "");
    if (argv[1] === "volume" && argv[2] === "create") {
      volumeExists = true;
      return result("roe-role-pilot-state-v1\n");
    }
    if (argv[1] === "volume" && argv[2] === "inspect")
      return result(
        JSON.stringify({
          Name: "roe-role-pilot-state-v1",
          Driver: "local",
          Scope: "local",
          Labels: labels,
          Options: null,
        }),
      );
    if (argv[1] === "volume" && argv[2] === "rm") {
      volumeExists = false;
      return result("roe-role-pilot-state-v1\n");
    }
    if (argv[1] === "run") {
      runCount++;
      writeFileSync(
        argv[argv.indexOf("--cidfile") + 1],
        String(runCount).repeat(64),
      );
      return result(
        runCount === 1
          ? ""
          : [
              "PASS: unsandboxed positive controls and private role directory",
              "nono 0.76.0",
              "PASS: intended reads and scoped writes; protected, sibling and child denials; filtered environment",
              "CapInh:\t0000000000000000",
              "CapPrm:\t0000000000000000",
              "CapEff:\t0000000000000000",
              "CapBnd:\t0000000000000000",
              "CapAmb:\t0000000000000000",
              "NoNewPrivs:\t1",
              "Seccomp:\t2",
            ].join("\n") + "\n",
      );
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
    if (argv[1] === "rm") return result(argv[2]);
    throw new Error("unexpected call: " + argv.join(" "));
  };
  try {
    assert.equal(await main(["--execute"], call), 0);
    assert.equal(runCount, 2);
    assert.equal(volumeExists, false);
    assert.equal(
      calls.filter((argv) => argv[1] === "volume" && argv[2] === "rm").length,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("failed boundary leaves the exact volume for reconciliation", async () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  const calls: string[][] = [];
  let runs = 0;
  const result = (stdout = "", status = 0) => ({ status, stdout, stderr: "" });
  const call = (argv: string[]) => {
    calls.push(argv);
    if (argv[1] === "version")
      return result(
        JSON.stringify({
          Version: "29.4.0",
          GitCommit: "daa0cb7f",
          Arch: "arm64",
        }),
      );
    if (argv[1] === "volume" && argv[2] === "ls") return result();
    if (argv[1] === "volume" && argv[2] === "create")
      return result("roe-role-pilot-state-v1\n");
    if (argv[1] === "volume" && argv[2] === "inspect")
      return result(
        JSON.stringify({
          Name: "roe-role-pilot-state-v1",
          Driver: "local",
          Scope: "local",
          Labels: labels,
          Options: null,
        }),
      );
    if (argv[1] === "run") {
      runs++;
      writeFileSync(
        argv[argv.indexOf("--cidfile") + 1],
        String(runs).repeat(64),
      );
      return result("", runs === 2 ? 1 : 0);
    }
    if (argv[1] === "inspect")
      return result(
        JSON.stringify({
          Running: false,
          Status: "exited",
          ExitCode: argv.at(-1)?.startsWith("2") ? 1 : 0,
          OOMKilled: false,
        }),
      );
    if (argv[1] === "logs" || argv[1] === "ps") return result();
    if (argv[1] === "rm") return result(argv[2]);
    throw new Error("unexpected call: " + argv.join(" "));
  };
  try {
    await assert.rejects(main(["--execute"], call), /inert boundary failed/);
    assert.ok(!calls.some((argv) => argv[1] === "volume" && argv[2] === "rm"));
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
import { main, plan, sources, verifyPins, type Call } from "./run.ts";

test("plan keeps the role isolated and uses only the disposable bridge", () => {
  const { command } = plan("123456abcdef");
  assert.ok(command.includes("--network=bridge"));
  assert.ok(command.includes("--read-only"));
  assert.ok(command.includes("--cap-drop=ALL"));
  assert.ok(command.includes("--security-opt=no-new-privileges=true"));
  assert.ok(!command.includes("--mount") && !command.includes("--volume"));
  assert.ok(!command.includes("--privileged") && !command.includes("--cap-add"));
  assert.ok(!command.includes("--rm"));
  assert.ok(command.includes("--pull=never"));
});

test("all streamed inputs match reviewed hashes", () => {
  verifyPins();
  assert.equal(sources()["profile.json"].endsWith("nono-provider-egress-probe/profile.json"), true);
});

test("default invocation cannot call Docker", () => {
  const refuse: Call = () => { throw new Error("unexpected runtime call"); };
  assert.equal(main([], refuse), 0);
});

test("changed engine stops before a container is created", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "synthetic-test-only";
  const calls: string[][] = [];
  const fake: Call = argv => {
    calls.push(argv);
    assert.deepEqual(argv.slice(0, 2), ["docker", "version"]);
    return { status: 0, stdout: JSON.stringify({ Version: "changed", GitCommit: "changed", Arch: "arm64" }), stderr: "" };
  };
  try { assert.throws(() => main(["--execute"], fake), /engine Version changed/); }
  finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
  assert.equal(calls.length, 1);
});

test("failed acceptance retains the exact container for reconciliation", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "synthetic-test-only";
  const cid = "a".repeat(64);
  const calls: string[][] = [];
  const fake: Call = argv => {
    calls.push(argv);
    if (argv[1] === "version") return { status: 0, stdout: JSON.stringify({ Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" }), stderr: "" };
    if (argv[1] === "run") {
      writeFileSync(argv[argv.indexOf("--cidfile") + 1], cid);
      return { status: 0, stdout: "CapInh:\t0000000000000000\n", stderr: "" };
    }
    if (argv[1] === "inspect") return { status: 0, stdout: JSON.stringify({ Running: false, Status: "exited", ExitCode: 0, OOMKilled: false }), stderr: "" };
    throw new Error(`unexpected cleanup on refusal: ${argv.join(" ")}`);
  };
  try { assert.throws(() => main(["--execute"], fake), /missing acceptance/); }
  finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
  assert.deepEqual(calls.map(argv => argv[1]), ["version", "run", "inspect"]);
});

test("accepted result removes only the exact stopped container", () => {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "synthetic-test-only";
  const cid = "b".repeat(64);
  const calls: string[][] = [];
  const passes = [
    "PASS: unsandboxed direct TCP positive control",
    "PASS: direct TCP permission denied",
    "PASS: direct TCP denied after exec and proxy-variable removal",
    "PASS: api.openai.com TLS verified, CONNECT 200, unauthenticated HTTP 401",
    "PASS: unlisted example.org explicitly denied by proxy with CONNECT 403",
  ];
  const caps = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]
    .map(name => `${name}:\t0000000000000000`);
  const fake: Call = argv => {
    calls.push(argv);
    if (argv[1] === "version") return { status: 0, stdout: JSON.stringify({ Version: "29.4.0", GitCommit: "daa0cb7f", Arch: "arm64" }), stderr: "" };
    if (argv[1] === "run") {
      writeFileSync(argv[argv.indexOf("--cidfile") + 1], cid);
      return { status: 0, stdout: [...passes, ...caps].join("\n"), stderr: "" };
    }
    if (argv[1] === "inspect") return { status: 0, stdout: JSON.stringify({ Running: false, Status: "exited", ExitCode: 0, OOMKilled: false }), stderr: "" };
    if (argv[1] === "rm") { assert.deepEqual(argv, ["docker", "rm", cid]); return { status: 0, stdout: `${cid}\n`, stderr: "" }; }
    if (argv[1] === "ps") return { status: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected call: ${argv.join(" ")}`);
  };
  try { assert.equal(main(["--execute"], fake), 0); }
  finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
  assert.deepEqual(calls.map(argv => argv[1]), ["version", "run", "inspect", "rm", "ps"]);
});

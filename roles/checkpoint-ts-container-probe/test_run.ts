import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, plan, runContainer, type Call } from "./run.ts";

test("plan mounts only one synthetic role volume and no host paths or sockets", () => {
  const result = plan("abcdef123456");
  assert.equal(
    result.volume,
    "roe-role-pilot-checkpoint-ts-fixture-abcdef123456",
  );
  assert.equal(
    result.mount,
    `type=volume,src=${result.volume},dst=/state,volume-nocopy`,
  );
  assert.equal(result.reader_mount, result.mount + ",readonly");
  for (const [phase, { command }] of Object.entries(result.containers)) {
    assert.equal(command.filter((part) => part === "--mount").length, 1);
    assert.ok(
      command.includes(phase === "reader" ? result.reader_mount : result.mount),
    );
    for (const bound of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges=true",
      "--pull=never",
    ])
      assert.ok(command.includes(bound), `${phase} missing ${bound}`);
    assert.ok(
      !command.some(
        (part) =>
          part.includes("type=bind") ||
          part.includes("/workspace") ||
          part.includes("/home/vscode") ||
          part.includes("docker.sock") ||
          part.includes("herdr"),
      ),
    );
    assert.ok(
      command.includes(
        `--user=${phase === "writer" || phase === "reader" ? "1000:1000" : "0:0"}`,
      ),
    );
  }
  assert.notDeepEqual(
    result.containers.writer.name,
    result.containers.reader.name,
  );
  assert.ok(
    result.containers.writer.command.includes(
      "/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777",
    ),
  );
});

function fixture(mode: "success" | "timeout" | "no-cid") {
  const directory = mkdtempSync(join(tmpdir(), "roe-checkpoint-runner-test-"));
  const cidfile = join(directory, "id");
  const cid = "a".repeat(64);
  const calls: string[] = [];
  const call: Call = (argv) => {
    calls.push(argv[1]);
    if (argv[1] === "run") {
      if (mode !== "no-cid") writeFileSync(cidfile, cid);
      return {
        status: mode === "timeout" ? null : 0,
        stdout: "fixture",
        stderr: "",
        error: mode === "timeout" ? new Error("timeout") : undefined,
      };
    }
    if (argv[1] === "inspect")
      return {
        status: 0,
        stdout: JSON.stringify({
          Running: false,
          Status: "exited",
          ExitCode: 0,
          OOMKilled: false,
        }),
        stderr: "",
      };
    if (argv[1] === "logs")
      return { status: 0, stdout: "fixture log", stderr: "" };
    if (argv[1] === "rm") return { status: 0, stdout: cid, stderr: "" };
    if (argv[1] === "ps") return { status: 0, stdout: "", stderr: "" };
    throw new Error("unexpected command: " + argv.join(" "));
  };
  try {
    const result = runContainer(
      "writer",
      plan("abcdef123456").containers.writer,
      cidfile,
      call,
    );
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test("stopped exact container is inspected then removed and absence checked", () => {
  const { result, calls } = fixture("success");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["run", "inspect", "logs", "rm", "ps"]);
});

test("timeout retains exact container for human review", () => {
  const { result, calls } = fixture("timeout");
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["run", "inspect", "logs"]);
});

test("missing invocation ID never attempts guessed cleanup", () => {
  const { result, calls } = fixture("no-cid");
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["run"]);
});

test("execute refuses before any Docker call without a Firstmate token", () => {
  const prior = process.env.ROE_RUNTIME_TOKEN;
  delete process.env.ROE_RUNTIME_TOKEN;
  let calls = 0;
  try {
    assert.throws(
      () =>
        main(["--execute"], () => {
          calls += 1;
          throw new Error("Docker called");
        }),
      /registered Firstmate reservation required/,
    );
    assert.equal(calls, 0);
  } finally {
    if (prior === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = prior;
  }
});

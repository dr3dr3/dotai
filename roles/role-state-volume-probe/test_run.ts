import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { checkVolumeInspection, main, rolePlan, type Result } from "./run.ts";

const volume = "roe-role-pilot-state-fixture-v1";
const labels = {
  "net.rockofeye.purpose": "role-state-acceptance-fixture",
  "net.rockofeye.role": "pilot",
  "net.rockofeye.contract": "typescript-checkpoint-v1",
};

test("candidate role volume has one mount, with no host or control socket", () => {
  const p = rolePlan("abcdef123456");
  assert.equal(p.volume, volume);
  for (const [phase, item] of Object.entries(p.containers)) {
    assert.equal(item.command.filter((arg) => arg === "--mount").length, 1);
    assert.ok(
      item.command.includes(phase === "reader" ? p.reader_mount : p.mount),
    );
    assert.ok(item.command.includes("--network=none"));
    assert.ok(item.command.includes("--read-only"));
    assert.ok(item.command.includes("--cap-drop=ALL"));
    assert.ok(item.command.includes("--security-opt=no-new-privileges=true"));
    assert.ok(
      !item.command.some((arg) =>
        /type=bind|\/workspace|\/home\/vscode|docker\.sock|herdr/i.test(arg),
      ),
    );
  }
});

test("foreign volume options and labels refuse", () => {
  const result = (overrides: object): Result => ({
    status: 0,
    stdout: JSON.stringify({
      Name: volume,
      Driver: "local",
      Scope: "local",
      Labels: labels,
      Options: null,
      ...overrides,
    }),
    stderr: "",
  });
  checkVolumeInspection(result({}));
  assert.throws(
    () => checkVolumeInspection(result({ Options: { device: "/workspace" } })),
    /options/,
  );
  assert.throws(
    () =>
      checkVolumeInspection(result({ Labels: { ...labels, owner: "other" } })),
    /labels/,
  );
  assert.throws(
    () => checkVolumeInspection(result({ Driver: "remote" })),
    /driver/,
  );
});

test("install and verify are separate calls and remove only the exact volume", () => {
  const prior = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  let exists = false;
  const calls: string[][] = [];
  const ids = ["a", "b", "c", "d"];
  let runIndex = 0;
  const result = (stdout = "", status = 0): Result => ({
    status,
    stdout,
    stderr: "",
  });
  const call = (argv: string[]): Result => {
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
      return result(exists ? volume + "\n" : "");
    if (argv[1] === "volume" && argv[2] === "create") {
      assert.equal(exists, false);
      exists = true;
      return result(volume + "\n");
    }
    if (argv[1] === "volume" && argv[2] === "inspect")
      return result(
        JSON.stringify({
          Name: volume,
          Driver: "local",
          Scope: "local",
          Labels: labels,
          Options: null,
        }),
      );
    if (argv[1] === "volume" && argv[2] === "rm") {
      assert.equal(argv[3], volume);
      exists = false;
      return result(volume + "\n");
    }
    if (argv[1] === "run") {
      const cidfile = argv[argv.indexOf("--cidfile") + 1];
      const id = ids[runIndex++].repeat(64);
      writeFileSync(cidfile, id);
      const name = argv[argv.indexOf("--name") + 1];
      if (name.includes("writer"))
        return result(
          "PASS: TypeScript checkpoint committed in private role directory\n",
        );
      if (name.includes("reader"))
        return result(
          "CHECKPOINT_JSON=" +
            JSON.stringify([
              {
                thread: {
                  id: "33333333-3333-4333-8333-333333333333",
                  checkpoint: "44444444-4444-4444-8444-444444444444",
                  coordinator: "11111111-1111-4111-8111-111111111111",
                  revision: 1,
                },
                checkpoint: {
                  id: "44444444-4444-4444-8444-444444444444",
                  thread: "33333333-3333-4333-8333-333333333333",
                  author: "11111111-1111-4111-8111-111111111111",
                  assignment_revision: 0,
                  content: {
                    position:
                      "Synthetic TypeScript checkpoint saved; no provider conversation exists",
                    decisions: ["Keep advisory role activation disabled"],
                    evidence: [
                      { type: "fixture", ref: "typescript-checkpoint-process" },
                    ],
                    questions: [
                      "How will authenticated native transcript resume be accepted?",
                    ],
                    blockers: ["Provider session identity is unverified"],
                    next_action:
                      "Run separate provider and safe-restore acceptance gates",
                  },
                },
                destination: { identity: null },
                runtime_authority: "unchanged",
              },
            ]) +
            "\n",
        );
      return result();
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
    if (argv[1] === "logs") return result();
    if (argv[1] === "rm") return result(argv[2] + "\n");
    if (argv[1] === "ps") return result();
    throw new Error("unexpected command: " + argv.join(" "));
  };
  try {
    assert.equal(main(["--install"], call), 0);
    assert.equal(exists, true);
    assert.equal(main(["--verify"], call), 0);
    assert.equal(exists, false);
    assert.equal(runIndex, 4);
    assert.equal(
      calls.filter((argv) => argv[1] === "volume" && argv[2] === "rm").length,
      1,
    );
  } finally {
    if (prior === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = prior;
  }
});

test("runtime mode refuses before any Docker call without reservation", () => {
  const prior = process.env.ROE_RUNTIME_TOKEN;
  delete process.env.ROE_RUNTIME_TOKEN;
  let calls = 0;
  try {
    assert.throws(
      () =>
        main(["--install"], () => {
          calls += 1;
          throw new Error("Docker called");
        }),
      /Firstmate reservation required/,
    );
    assert.equal(calls, 0);
  } finally {
    if (prior === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = prior;
  }
});

test("failed writer retains the exact volume and never starts the reader", () => {
  const prior = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "fake-reservation";
  const calls: string[][] = [];
  const result = (stdout = "", status = 0): Result => ({
    status,
    stdout,
    stderr: "",
  });
  const call = (argv: string[]): Result => {
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
    if (argv[1] === "volume" && argv[2] === "create") return result(volume);
    if (argv[1] === "volume" && argv[2] === "inspect")
      return result(
        JSON.stringify({
          Name: volume,
          Driver: "local",
          Scope: "local",
          Labels: labels,
          Options: null,
        }),
      );
    if (argv[1] === "run") {
      const name = argv[argv.indexOf("--name") + 1];
      writeFileSync(
        argv[argv.indexOf("--cidfile") + 1],
        (name.includes("writer") ? "b" : "a").repeat(64),
      );
      return result("", name.includes("writer") ? 1 : 0);
    }
    if (argv[1] === "inspect")
      return result(
        JSON.stringify({
          Running: false,
          Status: "exited",
          ExitCode: argv[argv.length - 1].startsWith("b") ? 1 : 0,
          OOMKilled: false,
        }),
      );
    if (argv[1] === "logs" || argv[1] === "ps") return result();
    if (argv[1] === "rm") return result(argv[2]);
    throw new Error("unexpected command: " + argv.join(" "));
  };
  try {
    assert.throws(
      () => main(["--install"], call),
      /writer failed; retain volume and reservation/,
    );
    assert.ok(!calls.some((argv) => argv[1] === "volume" && argv[2] === "rm"));
    assert.ok(
      !calls.some(
        (argv) =>
          argv[1] === "run" && argv.some((arg) => arg.includes("reader")),
      ),
    );
  } finally {
    if (prior === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = prior;
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commands,
  ENGINE,
  IMAGE,
  isCompatibleNode,
  main,
  type CommandCall,
} from "./volume_preflight.ts";
import {
  isCompatibleOperatorNode,
  main as wrapperMain,
  type SpawnCall,
} from "./run_volume_preflight.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPLACEMENT_SOURCES = [
  "PREFLIGHT-TASK-TS.md",
  "volume_preflight.ts",
  "test_volume_preflight.ts",
  "run_volume_preflight.ts",
];

function withReservation<T>(operation: () => T): T {
  const previous = process.env.ROE_RUNTIME_TOKEN;
  process.env.ROE_RUNTIME_TOKEN = "synthetic-fixture-token";
  try {
    return operation();
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
}

test("commands grant only writer CHOWN and keep the reader capability-free", () => {
  const { writer, reader } = commands("abcdef123456");
  const writerShell = writer.at(-1) ?? "";
  assert.match(writerShell, /chown 1000:1000 \/fixture\/auth\.json/);
  assert.equal(writer.filter((value) => value === "--cap-drop=ALL").length, 1);
  assert.deepEqual(
    writer.filter((value) => value.startsWith("--cap-add=")),
    ["--cap-add=CHOWN"],
  );
  assert.equal(reader.filter((value) => value === "--cap-drop=ALL").length, 1);
  assert.deepEqual(
    reader.filter((value) => value.startsWith("--cap-add=")),
    [],
  );
  assert.equal(reader.includes("--privileged"), false);
  assert.equal(writer.includes("--privileged"), false);
});

test("both containers are network-none, bounded, and use the pinned image", () => {
  const { writer, reader } = commands("abcdef123456");
  assert.match(IMAGE, /^sha256:[a-f0-9]{64}$/);
  for (const command of [writer, reader]) {
    assert.deepEqual(
      command.filter((value) => /^--net(?:work)?(?:=|$)/.test(value)),
      ["--network=none"],
    );
    assert.ok(command.includes("--read-only"));
    assert.ok(command.includes("--security-opt=no-new-privileges=true"));
    assert.ok(command.includes("--memory=128m"));
    assert.ok(command.includes("--cpus=1"));
    assert.ok(command.includes("--pids-limit=32"));
    assert.ok(command.includes(IMAGE));
  }
});

test("replacement sources contain no real volume or credential path", () => {
  const prohibited = [
    ["roe", "devcontainer", "ai"].join("-"),
    ["", "home", "vscode", ".ai"].join("/"),
    ["codex", "auth.json"].join("/"),
    ["claude", ".credentials.json"].join("/"),
  ];
  for (const name of REPLACEMENT_SOURCES) {
    const source = readFileSync(join(HERE, name), "utf8");
    for (const value of prohibited) assert.equal(source.includes(value), false);
  }
});

test("reader acceptance requires the exact file and denies the sibling", () => {
  const { volume, reader } = commands("abcdef123456");
  assert.ok(
    reader.includes(
      `type=volume,src=${volume},volume-subpath=auth.json,dst=/tmp/auth.json,readonly`,
    ),
  );
  const shell = reader.at(-1) ?? "";
  assert.match(shell, /test -f \/tmp\/auth\.json/);
  assert.match(shell, /chmod 0600 \/tmp\/auth\.json/);
  assert.match(shell, /stat -c %a \/tmp\/auth\.json/);
  assert.match(shell, /test ! -e \/tmp\/other\.txt/);
  assert.match(shell, /sibling absent/);
});

test("successful acceptance removes only the exact synthetic volume", () => {
  const calls: string[][] = [];
  const fake: CommandCall = (argv) => {
    calls.push(argv);
    if (argv[1] === "version") return JSON.stringify(ENGINE);
    return "synthetic-ok";
  };
  assert.equal(
    withReservation(() => main(["--execute"], fake, "22.23.0")),
    0,
  );
  const runs = calls.filter((argv) => argv[1] === "run");
  assert.equal(runs.length, 2);
  const removal = calls.at(-1);
  assert.deepEqual(removal?.slice(0, 3), ["docker", "volume", "rm"]);
  assert.match(
    removal?.at(-1) ?? "",
    /^roe-auth-subpath-fixture-[a-f0-9]{12}$/,
  );
});

test("writer failure still removes the exact synthetic volume", () => {
  const calls: string[][] = [];
  const fake: CommandCall = (argv) => {
    calls.push(argv);
    if (argv[1] === "version") return JSON.stringify(ENGINE);
    if (argv[1] === "run") throw new Error("synthetic writer failed");
    return "synthetic-ok";
  };
  assert.equal(
    withReservation(() => main(["--execute"], fake, "22.23.9")),
    1,
  );
  const removal = calls.find(
    (argv) => argv[1] === "volume" && argv[2] === "rm",
  );
  assert.match(
    removal?.at(-1) ?? "",
    /^roe-auth-subpath-fixture-[a-f0-9]{12}$/,
  );
});

test("engine mismatch stops before creating the synthetic volume", () => {
  const calls: string[][] = [];
  const fake: CommandCall = (argv) => {
    calls.push(argv);
    return JSON.stringify({ ...ENGINE, Version: "29.4.1" });
  };
  assert.throws(
    () => withReservation(() => main(["--execute"], fake, "22.23.2")),
    /Docker engine changed/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["docker", "version", "--format"]);
});

test("Node compatibility is stable 22.23.x only", () => {
  const accepted = ["22.23.0", "22.23.2", "22.23.99"];
  const rejected = [
    "22.22.9",
    "22.24.0",
    "23.23.2",
    "22.23",
    "v22.23.2",
    "22.23.2-rc.1",
    "22.23.2+build",
  ];
  for (const version of accepted) {
    assert.equal(isCompatibleNode(version), true);
    assert.equal(isCompatibleOperatorNode(version), true);
  }
  for (const version of rejected) {
    assert.equal(isCompatibleNode(version), false);
    assert.equal(isCompatibleOperatorNode(version), false);
  }
});

test("incompatible Node stops direct execution before any Docker call", () => {
  let called = false;
  const fake: CommandCall = () => {
    called = true;
    return "";
  };
  assert.throws(
    () => withReservation(() => main(["--execute"], fake, "22.24.0")),
    /stable 22\.23\.x/,
  );
  assert.equal(called, false);
});

test("default fixture mode is plan-only and execution requires reservation", () => {
  assert.equal(main([]), 0);
  const previous = process.env.ROE_RUNTIME_TOKEN;
  delete process.env.ROE_RUNTIME_TOKEN;
  try {
    assert.throws(
      () => main(["--execute"], () => "", "22.23.1"),
      /reservation required/,
    );
  } finally {
    if (previous === undefined) delete process.env.ROE_RUNTIME_TOKEN;
    else process.env.ROE_RUNTIME_TOKEN = previous;
  }
});

test("brief has only the replacement identity and authoritative home", () => {
  const brief = readFileSync(join(HERE, "PREFLIGHT-TASK-TS.md"), "utf8");
  assert.doesNotMatch(brief, /ai-auth-file-subpath-preflight(?!-20261005)/);
  assert.equal(
    (brief.match(/ai-auth-file-subpath-preflight-20261005/g) ?? []).length,
    1,
  );
  assert.ok(brief.includes("/workspace/.firstmate-home"));
  assert.equal((brief.match(/\/workspace\/\.firstmate-home/g) ?? []).length, 1);
  assert.match(brief, /1 October request is historical evidence only/);
  assert.match(brief, /must never be\s+rerun, restored/);
});

test("tracked wrapper invokes only the registered synthetic fixture", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fake: SpawnCall = (file, args) => {
    calls.push({ file, args });
    return { status: 0, signal: null };
  };
  assert.equal(wrapperMain(["--execute"], fake, "22.23.4"), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "roe-coordination");
  assert.deepEqual(calls[0].args.slice(0, 5), [
    "run",
    "--home",
    "/workspace/.firstmate-home",
    "--task",
    "ai-auth-file-subpath-preflight-20261005",
  ]);
  assert.deepEqual(calls[0].args.slice(-2), [
    join(HERE, "volume_preflight.ts"),
    "--execute",
  ]);
});

test("tracked wrapper contains no direct external or privileged operation", () => {
  const wrapper = readFileSync(join(HERE, "run_volume_preflight.ts"), "utf8");
  const prohibited = [
    "docker",
    "--network",
    "://",
    "roe-role",
    "codex",
    "claude",
    "provider",
    ["", "home", "vscode", ".ai"].join("/"),
    ["roe", "devcontainer", "ai"].join("-"),
  ];
  for (const value of prohibited) assert.equal(wrapper.includes(value), false);
  assert.equal((wrapper.match(/spawn\(/g) ?? []).length, 1);
  assert.match(wrapper, /spawn\("roe-coordination", command\)/);
});

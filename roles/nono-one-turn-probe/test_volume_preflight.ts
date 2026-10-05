import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanup,
  commands,
  DOCKER,
  ENGINE,
  FIXTURE_HASH_ENV,
  IMAGE,
  isCompatibleNode,
  main,
  type CommandCall,
} from "./volume_preflight.ts";
import {
  cleanEnvironment,
  isCompatibleOperatorNode,
  main as wrapperMain,
  verifyApprovedSources,
  verifyBootstrap,
  type SpawnCall,
} from "./run_volume_preflight.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, "volume_preflight.ts");
const FIXTURE_SHA = createHash("sha256")
  .update(readFileSync(FIXTURE_PATH))
  .digest("hex");
const REPLACEMENT_SOURCES = [
  "PREFLIGHT-TASK-TS.md",
  "volume_preflight.ts",
  "test_volume_preflight.ts",
  "run_volume_preflight.ts",
];
const noop = () => undefined;

function executionEnvironment(): NodeJS.ProcessEnv {
  return {
    ROE_RUNTIME_TOKEN: "synthetic-fixture-token",
    [FIXTURE_HASH_ENV]: FIXTURE_SHA,
  };
}

function missing(kind: string): Error & { stderr: string } {
  return Object.assign(new Error(`No such ${kind}`), {
    stderr: `Error response from daemon: No such ${kind}`,
  });
}

function successfulDocker(calls: string[][]): CommandCall {
  return (argv) => {
    calls.push(argv);
    if (argv[1] === "version") return JSON.stringify(ENGINE);
    if (argv[1] === "container" && argv[2] === "rm") {
      throw missing("container");
    }
    if (argv[1] === "container" && argv[2] === "inspect") {
      throw missing("container");
    }
    if (argv[1] === "volume" && argv[2] === "inspect") {
      throw missing("volume");
    }
    return "synthetic-ok";
  };
}

test("writer prepares mode before chown with CHOWN as its only added capability", () => {
  const { writer, reader } = commands("abcdef123456");
  const writerShell = writer.at(-1) ?? "";
  assert.ok(
    writerShell.indexOf("chmod 0400") < writerShell.indexOf("chown 1000:1000"),
  );
  assert.equal(writer.filter((value) => value === "--cap-drop=ALL").length, 1);
  assert.deepEqual(
    writer.filter((value) => value.startsWith("--cap-add=")),
    ["--cap-add=CHOWN"],
  );
  assert.match(writer.join(" "), /dst=\/fixture,volume-nocopy/);
  assert.equal(reader.filter((value) => value === "--cap-drop=ALL").length, 1);
  assert.deepEqual(
    reader.filter((value) => value.startsWith("--cap-add=")),
    [],
  );
  assert.equal(reader.includes("--privileged"), false);
  assert.equal(writer.includes("--privileged"), false);
});

test("both containers are network-none, bounded, and use absolute pinned inputs", () => {
  const { writer, reader } = commands("abcdef123456");
  assert.equal(DOCKER, "/usr/bin/docker");
  assert.match(IMAGE, /^sha256:[a-f0-9]{64}$/);
  for (const command of [writer, reader]) {
    assert.equal(command[0], DOCKER);
    assert.deepEqual(
      command.filter((value) => /^--net(?:work)?(?:=|$)/.test(value)),
      ["--network=none"],
    );
    assert.ok(command.includes("--read-only"));
    assert.ok(command.includes("--security-opt=no-new-privileges=true"));
    assert.ok(command.includes("--memory=128m"));
    assert.ok(command.includes("--memory-swap=128m"));
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

test("reader acceptance requires one read-only exact-file mount and denies sibling", () => {
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
  assert.match(shell, /proc\/self\/mountinfo/);
  assert.match(shell, /mount_count.*-eq 1/);
  assert.match(shell, /\*,ro,\*/);
  assert.match(shell, /sibling absent/);
});

test("successful acceptance removes and verifies exact synthetic objects", () => {
  const calls: string[][] = [];
  assert.equal(
    main(
      ["--execute"],
      successfulDocker(calls),
      "22.23.0",
      executionEnvironment(),
      FIXTURE_PATH,
      noop,
    ),
    0,
  );
  assert.equal(calls.filter((argv) => argv[1] === "run").length, 2);
  assert.equal(
    calls.filter((argv) => argv[1] === "container" && argv[2] === "inspect")
      .length,
    2,
  );
  assert.equal(
    calls.filter((argv) => argv[1] === "volume" && argv[2] === "inspect")
      .length,
    1,
  );
});

test("writer failure still cleans and verifies exact synthetic objects", () => {
  const calls: string[][] = [];
  const base = successfulDocker(calls);
  const fake: CommandCall = (argv) => {
    if (argv[1] === "run") {
      calls.push(argv);
      throw new Error("synthetic writer failed");
    }
    return base(argv);
  };
  assert.equal(
    main(
      ["--execute"],
      fake,
      "22.23.9",
      executionEnvironment(),
      FIXTURE_PATH,
      noop,
    ),
    1,
  );
  assert.ok(calls.some((argv) => argv[1] === "volume" && argv[2] === "rm"));
});

test("volume-create timeout still attempts and verifies cleanup", () => {
  const calls: string[][] = [];
  const base = successfulDocker(calls);
  const fake: CommandCall = (argv) => {
    if (argv[1] === "volume" && argv[2] === "create") {
      calls.push(argv);
      throw new Error("create timed out");
    }
    return base(argv);
  };
  assert.equal(
    main(
      ["--execute"],
      fake,
      "22.23.1",
      executionEnvironment(),
      FIXTURE_PATH,
      noop,
    ),
    1,
  );
  assert.ok(calls.some((argv) => argv[1] === "container" && argv[2] === "rm"));
  assert.ok(calls.some((argv) => argv[1] === "volume" && argv[2] === "rm"));
});

test("failed cleanup verification retains a failure result", () => {
  const calls: string[][] = [];
  const messages: string[] = [];
  const base = successfulDocker(calls);
  const fake: CommandCall = (argv) => {
    if (argv[1] === "volume" && argv[2] === "inspect") {
      calls.push(argv);
      return "still-present";
    }
    return base(argv);
  };
  assert.equal(
    main(
      ["--execute"],
      fake,
      "22.23.1",
      executionEnvironment(),
      FIXTURE_PATH,
      (message) => messages.push(message),
    ),
    1,
  );
  assert.ok(messages.some((message) => message.includes("cleanup unverified")));
});

test("cleanup treats daemon errors as unverified rather than absent", () => {
  const fixture = commands("abcdef123456");
  const messages: string[] = [];
  const fake: CommandCall = (argv) => {
    if (argv[2] === "inspect") throw new Error("daemon unavailable");
    return "";
  };
  assert.equal(
    cleanup(fixture, fake, (message) => messages.push(message)),
    false,
  );
  assert.equal(
    messages.filter((message) => message.includes("cannot confirm")).length,
    3,
  );
});

test("every engine field and malformed server data fail before volume creation", () => {
  const responses = [
    JSON.stringify({ ...ENGINE, Version: "29.4.1" }),
    JSON.stringify({ ...ENGINE, GitCommit: "different" }),
    JSON.stringify({ ...ENGINE, Arch: "amd64" }),
    "null",
    "not-json",
  ];
  for (const response of responses) {
    const calls: string[][] = [];
    const fake: CommandCall = (argv) => {
      calls.push(argv);
      return response;
    };
    assert.throws(() =>
      main(
        ["--execute"],
        fake,
        "22.23.2",
        executionEnvironment(),
        FIXTURE_PATH,
        noop,
      ),
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), [DOCKER, "version", "--format"]);
  }
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

test("incompatible Node and bad fixture markers stop before Docker", () => {
  let called = false;
  const fake: CommandCall = () => {
    called = true;
    return "";
  };
  assert.throws(
    () =>
      main(
        ["--execute"],
        fake,
        "22.24.0",
        executionEnvironment(),
        FIXTURE_PATH,
        noop,
      ),
    /stable 22\.23\.x/,
  );
  assert.throws(
    () =>
      main(
        ["--execute"],
        fake,
        "22.23.1",
        { ROE_RUNTIME_TOKEN: "x" },
        FIXTURE_PATH,
        noop,
      ),
    /hash marker required/,
  );
  assert.throws(
    () =>
      main(
        ["--execute"],
        fake,
        "22.23.1",
        { ROE_RUNTIME_TOKEN: "x", [FIXTURE_HASH_ENV]: "a".repeat(64) },
        FIXTURE_PATH,
        noop,
      ),
    /does not match/,
  );
  assert.equal(called, false);
});

test("default fixture mode is plan-only and execution requires reservation", () => {
  assert.equal(
    main([], () => "", process.versions.node, {}, FIXTURE_PATH, noop),
    0,
  );
  assert.throws(
    () =>
      main(
        ["--execute"],
        () => "",
        "22.23.1",
        { [FIXTURE_HASH_ENV]: FIXTURE_SHA },
        FIXTURE_PATH,
        noop,
      ),
    /reservation required/,
  );
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

test("wrapper snapshots the fixture and inherits output with a clean environment", () => {
  let snapshotPath = "";
  const fake: SpawnCall = (file, args, options) => {
    assert.equal(file, "/home/vscode/.local/bin/roe-coordination");
    assert.deepEqual(args.slice(0, 5), [
      "run",
      "--home",
      "/workspace/.firstmate-home",
      "--task",
      "ai-auth-file-subpath-preflight-20261005",
    ]);
    snapshotPath = args.at(-2) ?? "";
    assert.equal(args.at(-1), "--execute");
    assert.notEqual(snapshotPath, FIXTURE_PATH);
    assert.equal(existsSync(snapshotPath), true);
    assert.equal(
      createHash("sha256").update(readFileSync(snapshotPath)).digest("hex"),
      FIXTURE_SHA,
    );
    assert.equal(options.stdio, "inherit");
    assert.equal(options.env[FIXTURE_HASH_ENV], FIXTURE_SHA);
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.ROE_RUNTIME_TOKEN, undefined);
    return { status: 0, signal: null };
  };
  assert.equal(wrapperMain(["--execute"], fake, "22.23.4"), 0);
  assert.equal(existsSync(snapshotPath), false);
});

test("wrapper rejects hash mismatch and handles error, signal, and non-zero exit", () => {
  assert.throws(
    () => verifyApprovedSources(() => Buffer.from("changed")),
    /SHA-256 changed/,
  );
  const errorSpawn: SpawnCall = () => ({
    status: null,
    error: new Error("spawn failed"),
  });
  assert.throws(
    () => wrapperMain(["--execute"], errorSpawn, "22.23.1"),
    /spawn failed/,
  );
  const signalSpawn: SpawnCall = () => ({ status: null, signal: "SIGTERM" });
  assert.throws(
    () => wrapperMain(["--execute"], signalSpawn, "22.23.1"),
    /did not return an exit code/,
  );
  const nonzeroSpawn: SpawnCall = () => ({ status: 7, signal: null });
  assert.equal(wrapperMain(["--execute"], nonzeroSpawn, "22.23.1"), 7);
});

test("wrapper environment and source contain no external or privileged operation", () => {
  const environment = cleanEnvironment();
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.NODE_PATH, undefined);
  assert.equal(environment.ROE_RUNTIME_TOKEN, undefined);
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.throws(
    () => verifyBootstrap({ NODE_OPTIONS: "--require=unsafe" }, []),
    /injection environment/,
  );
  assert.throws(
    () => verifyBootstrap({}, ["--import=unsafe"]),
    /preload and loader/,
  );

  const wrapper = readFileSync(join(HERE, "run_volume_preflight.ts"), "utf8");
  const prohibited = [
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
  assert.match(wrapper, /spawn\(COORDINATION, command/);
});

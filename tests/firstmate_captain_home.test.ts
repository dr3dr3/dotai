import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CONFIGURED_HOME,
  REGISTRY_PATH,
  main,
  resolveHome,
} from "../scripts/firstmate-captain-home.ts";

const SOURCE = new URL("../scripts/firstmate-captain-home.ts", import.meta.url);

type Fixture = { root: string; home: string; registry: string };

function fixture(registry?: unknown): Fixture {
  const root = mkdtempSync(join(tmpdir(), "fm-captain-home-"));
  const home = join(root, "home");
  for (const part of ["config", "data", "state"])
    mkdirSync(join(home, part), { recursive: true });
  const registryPath = join(root, "registry.json");
  writeFileSync(
    registryPath,
    typeof registry === "string"
      ? registry
      : JSON.stringify(registry ?? { version: 1, homes: [home] }),
  );
  return { root, home, registry: registryPath };
}

function withFixture(
  run: (f: Fixture) => void,
  registry?: unknown,
): () => void {
  return () => {
    const f = fixture(registry);
    try {
      run(f);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  };
}

test(
  "1. absent FM_HOME selects the configured home",
  withFixture((f) => {
    assert.equal(resolveHome(undefined, f.registry, f.home), f.home);
    assert.equal(resolveHome("", f.registry, f.home), f.home);
  }),
);

test(
  "2. the exact configured home is accepted, including through a symlink",
  withFixture((f) => {
    assert.equal(resolveHome(f.home, f.registry, f.home), f.home);
    const link = join(f.root, "link");
    symlinkSync(f.home, link);
    assert.equal(resolveHome(link, f.registry, f.home), f.home);
  }),
);

test(
  "3. any other home is rejected",
  withFixture((f) => {
    assert.throws(() => resolveHome(f.root, f.registry, f.home), /differs/);
    assert.throws(
      () => resolveHome(join(f.root, "absent"), f.registry, f.home),
      /FM_HOME/,
    );
  }),
);

test(
  "4a. a missing registry is rejected",
  withFixture((f) => {
    rmSync(f.registry);
    assert.throws(() => resolveHome(undefined, f.registry, f.home), /registry/);
  }),
);

for (const [name, body] of [
  ["not JSON", "{not json"],
  ["version 2", { version: 2, homes: [] }],
  ["no version", { homes: [] }],
  ["homes not an array", { version: 1, homes: "x" }],
  ["homes with a non-string", { version: 1, homes: [1] }],
  ["not an object", [1]],
] as const) {
  test(`4b. a malformed registry is rejected (${name})`, () => {
    const f = fixture(body);
    try {
      assert.throws(
        () => resolveHome(undefined, f.registry, f.home),
        /registry/,
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test(
  "5. an unregistered configured home is rejected",
  withFixture(
    (f) => {
      assert.throws(
        () => resolveHome(undefined, f.registry, f.home),
        /not registered/,
      );
    },
    { version: 1, homes: ["/elsewhere"] },
  ),
);

for (const part of ["config", "data", "state"]) {
  test(
    `6. a missing ${part} directory is rejected and never created`,
    withFixture((f) => {
      rmSync(join(f.home, part), { recursive: true });
      assert.throws(
        () => resolveHome(undefined, f.registry, f.home),
        /not initialised/,
      );
      assert.equal(existsSync(join(f.home, part)), false);
    }),
  );
}

test(
  "a file standing in for a required directory is rejected",
  withFixture((f) => {
    rmSync(join(f.home, "state"), { recursive: true });
    writeFileSync(join(f.home, "state"), "");
    assert.throws(
      () => resolveHome(undefined, f.registry, f.home),
      /not initialised/,
    );
  }),
);

test(
  "a missing configured home is rejected",
  withFixture((f) => {
    rmSync(f.home, { recursive: true });
    assert.throws(
      () => resolveHome(undefined, f.registry, f.home),
      /configured captain home/,
    );
    assert.equal(existsSync(f.home), false);
  }),
);

test(
  "main emits only the resolved home and exits 0",
  withFixture((f) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(
      { FM_HOME: f.home },
      (s) => out.push(s),
      (s) => err.push(s),
      f.registry,
      f.home,
    );
    assert.equal(code, 0);
    assert.deepEqual(out, [`${f.home}\n`]);
    assert.deepEqual(err, []);
  }),
);

test(
  "main fails with one bounded diagnostic line and no stdout",
  withFixture(
    (f) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = main(
        { FM_HOME: f.home },
        (s) => out.push(s),
        (s) => err.push(s),
        f.registry,
        f.home,
      );
      assert.equal(code, 1);
      assert.deepEqual(out, []);
      assert.equal(err.length, 1);
      assert.match(err[0], /^firstmate-captain-home: [^\n]{1,240}\n$/);
    },
    { version: 1, homes: ["x".repeat(5000)] },
  ),
);

test("production roots are fixed and not environment-redirectable", () => {
  assert.equal(CONFIGURED_HOME, "/workspace/.firstmate-home");
  assert.equal(REGISTRY_PATH, "/workspace/.git/roe-runtime.json");
  const source = readFileSync(SOURCE, "utf8");
  const envReads = source.match(/process\.env(\.[A-Za-z_]+|\[[^\]]+\])?/g);
  assert.deepEqual(envReads, ["process.env"]);
  assert.match(source, /env\.FM_HOME/);
  assert.doesNotMatch(source, /env\.(?!FM_HOME\b)[A-Za-z_]+/);
});

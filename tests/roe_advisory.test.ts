import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoster, main } from "../scripts/roe-advisory.ts";
import type { Env, Herdr } from "../scripts/roe-advisory.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_SET = [
  "baxter",
  "design",
  "plan",
  "security",
  "quality",
  "standards",
];
const READS = new Set(["list", "get"]);
/** The value draft #62's scripts/roe-role.ts pins. */
const CATALOGUE_SHA256 =
  "a2ee6fe05113147028da6d67e9c5b0df4534b1b67f7082dba354d5ff9d2fbd54";

type Row = Record<string, string | null>;
/** An in-memory Herdr session that records every command it is given. */
function fakeHerdr() {
  const state = {
    workspaces: [{ workspace_id: "w1", label: "ai" }] as Row[],
    tabs: [] as Row[],
    panes: [] as Row[],
    agents: [] as Row[],
  };
  const calls: string[][] = [];
  let n = 10;
  const newTab = (workspace: string, label: string) => {
    const tab = {
      tab_id: `${workspace}:t${++n}`,
      workspace_id: workspace,
      label,
    };
    const pane = {
      pane_id: `${workspace}:p${++n}`,
      tab_id: tab.tab_id,
      workspace_id: workspace,
      label: null,
    };
    state.tabs.push(tab);
    state.panes.push(pane);
    return { tab, root_pane: pane };
  };
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
  const herdr: Herdr = (args) => {
    calls.push(args);
    const [group, verb] = args;
    if (verb === "list") {
      const ws = flag(args, "--workspace");
      if (group === "workspace") return { workspaces: state.workspaces };
      if (group === "agent") return { agents: state.agents };
      if (group === "tab")
        return { tabs: state.tabs.filter((t) => t.workspace_id === ws) };
      if (group === "pane")
        return { panes: state.panes.filter((p) => p.workspace_id === ws) };
    }
    if (group === "workspace" && verb === "create") {
      const workspace = {
        workspace_id: `w${++n}`,
        label: flag(args, "--label"),
      };
      state.workspaces.push(workspace);
      return { workspace, ...newTab(workspace.workspace_id, "1") };
    }
    if (group === "tab" && verb === "create")
      return newTab(flag(args, "--workspace"), flag(args, "--label"));
    if (verb === "rename") {
      const rows = group === "tab" ? state.tabs : state.panes;
      const key = group === "tab" ? "tab_id" : "pane_id";
      rows.find((r) => r[key] === args[2])!.label = args[3];
      return {};
    }
    if (group === "agent" && verb === "start") {
      const pane = state.panes.find((p) => p.pane_id === flag(args, "--pane"))!;
      state.agents.push({
        pane_id: pane.pane_id,
        tab_id: pane.tab_id,
        agent: flag(args, "--kind"),
        name: args[2],
        agent_status: "idle",
      });
      return {};
    }
    if (group === "pane" && verb === "run" && args[3] === "/exit") {
      state.agents = state.agents.filter((a) => a.pane_id !== args[2]);
      return {};
    }
    if (group === "tab" && verb === "close") {
      state.tabs = state.tabs.filter((t) => t.tab_id !== args[2]);
      state.panes = state.panes.filter((p) => p.tab_id !== args[2]);
      return {};
    }
    if (group === "agent" && verb === "focus") return {};
    throw new Error(`fake herdr: unexpected ${args.join(" ")}`);
  };
  const mutations = () => calls.filter((c) => !READS.has(c[1]));
  return { state, calls, herdr, mutations };
}

/** A source tree with the real roster plus stand-in prompts, and a fresh home. */
function setup(prompts = FIRST_SET) {
  const root = mkdtempSync(join(tmpdir(), "roe-advisory-"));
  const source = join(root, "src");
  mkdirSync(join(source, "roles/prompts"), { recursive: true });
  for (const file of ["roles/advisory.json", "roles/catalogue.json"])
    cpSync(join(REPO, file), join(source, file));
  writeFileSync(
    join(source, "roles/prompts/checkpoint-template.md"),
    "Role / instance / session pointer:\n",
  );
  for (const id of prompts)
    writeFileSync(join(source, "roles/prompts", `${id}.md`), `charter ${id}\n`);
  const fake = fakeHerdr();
  const lines: string[] = [];
  const env: Env = {
    source,
    home: join(root, "home"),
    cwd: "/workspace",
    herdr: fake.herdr,
    out: (line) => lines.push(line),
    sleep: () => {},
  };
  const checkpoint = (id: string) =>
    join(root, "home/.ai/roles", id, "checkpoint.md");
  return { env, fake, lines, checkpoint };
}

test("the roster holds exactly the first set, within the Herdr naming limits", () => {
  const roster = loadRoster(REPO);
  assert.deepEqual(Object.keys(roster.roles).sort(), [...FIRST_SET].sort());
  assert.equal(roster.roles["baxter"].title, "Baxter \u2014 Idea Lead");
  assert.equal(
    roster.charter,
    "reference/taxonomy-topology/ai-pilot-role-charters.md",
  );
});

test("the shared catalogue is read, never changed: its pinned SHA-256 holds", () => {
  const sha = createHash("sha256")
    .update(readFileSync(join(REPO, "roles/catalogue.json")))
    .digest("hex");
  assert.equal(sha, CATALOGUE_SHA256);
});

test("an advisory role missing from the catalogue is refused", () => {
  const { env } = setup();
  const file = join(env.source, "roles/advisory.json");
  const advisory = JSON.parse(readFileSync(file, "utf8"));
  advisory.roles.ghost = { ...advisory.roles.baxter, tab: "ghost" };
  writeFileSync(file, JSON.stringify(advisory));
  assert.throws(() => main(["list"], env), /ghost is not in the catalogue/);
});

test("plan <role> is the same dry run as start --plan", () => {
  const { env, fake, lines } = setup();
  assert.equal(main(["plan", "baxter"], env), 0);
  assert.deepEqual(fake.mutations(), []);
  assert.match(
    lines.join("\n"),
    /plan: create tab phase\/idea with pane baxter·claude/,
  );
});

test("--plan reads the session but changes nothing", () => {
  const { env, fake, lines, checkpoint } = setup();
  assert.equal(main(["start", "baxter", "--plan"], env), 0);
  assert.deepEqual(fake.mutations(), []);
  assert.equal(existsSync(checkpoint("baxter")), false);
  assert.match(
    lines.join("\n"),
    /plan: create workspace phase with a term tab/,
  );
  assert.match(
    lines.join("\n"),
    /plan: create tab phase\/idea with pane baxter·claude/,
  );
});

test("start lays out the role by the conventions and seeds a private checkpoint", () => {
  const { env, fake, checkpoint } = setup();
  assert.equal(main(["start", "baxter"], env), 0);
  const phase = fake.state.workspaces.find((w) => w.label === "phase")!;
  const tabs = fake.state.tabs.filter(
    (t) => t.workspace_id === phase.workspace_id,
  );
  assert.deepEqual(
    tabs.map((t) => t.label),
    ["term", "idea"],
  );
  assert.deepEqual(
    fake.state.panes.map((p) => p.label),
    ["you·shell", "baxter·claude"],
  );
  const start = fake.calls.find((c) => c[0] === "agent" && c[1] === "start")!;
  const native = start.slice(start.indexOf("--") + 1);
  assert.deepEqual(native.slice(0, 4), [
    "--append-system-prompt-file",
    join(env.source, "roles/prompts/baxter.md"),
    "--name",
    "baxter",
  ]);
  assert.match(native[4], new RegExp(checkpoint("baxter")));
  assert.equal(
    readFileSync(checkpoint("baxter"), "utf8"),
    "Role / instance / session pointer:\n",
  );
  assert.equal(statSync(checkpoint("baxter")).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(checkpoint("baxter"))).mode & 0o777, 0o700);
});

test("a second start of a live role starts nothing and reports where it is", () => {
  const { env, fake, lines } = setup();
  main(["start", "baxter"], env);
  const before = fake.mutations().length;
  assert.equal(main(["start", "baxter"], env), 0);
  assert.equal(fake.mutations().length, before);
  assert.equal(fake.state.agents.length, 1);
  assert.match(lines.at(-1)!, /^running: baxter in phase\/idea/);
});

test("--focus on a live role focuses it and starts nothing", () => {
  const { env, fake } = setup();
  main(["start", "baxter"], env);
  const before = fake.mutations().length;
  main(["start", "baxter", "--focus"], env);
  assert.deepEqual(fake.mutations().slice(before), [
    ["agent", "focus", fake.state.agents[0].pane_id],
  ]);
});

test("a second role in the same workspace reuses it", () => {
  const { env, fake } = setup();
  main(["start", "baxter"], env);
  main(["start", "design"], env);
  assert.equal(
    fake.state.workspaces.filter((w) => w.label === "phase").length,
    1,
  );
  assert.equal(
    fake.calls.filter((c) => c[0] === "workspace" && c[1] === "create").length,
    1,
  );
});

test("an existing checkpoint is never overwritten", () => {
  const { env, checkpoint } = setup();
  mkdirSync(dirname(checkpoint("quality")), { recursive: true });
  writeFileSync(checkpoint("quality"), "work in progress\n");
  main(["start", "quality"], env);
  assert.equal(
    readFileSync(checkpoint("quality"), "utf8"),
    "work in progress\n",
  );
});

test("refusals happen before any change", async (t) => {
  const cases: [
    string,
    (s: ReturnType<typeof setup>) => void,
    string[],
    RegExp,
  ][] = [
    [
      "missing charter prompt",
      () => {},
      ["start", "plan"],
      /no charter prompt/,
    ],
    ["unknown role", () => {}, ["start", "hannibal"], /unknown role/],
    [
      "unknown option",
      () => {},
      ["start", "baxter", "--yes"],
      /unknown option/,
    ],
    [
      "tab without a live agent",
      (s) => {
        s.env.herdr(["workspace", "create", "--label", "phase"]);
        const ws = s.fake.state.workspaces.at(-1)!.workspace_id!;
        s.env.herdr(["tab", "create", "--workspace", ws, "--label", "idea"]);
      },
      ["start", "baxter"],
      /exists without a live claude agent/,
    ],
    [
      "agent name already live elsewhere",
      (s) => {
        s.fake.state.agents.push({
          pane_id: "w1:p9",
          tab_id: "w1:t9",
          agent: "claude",
          name: "baxter",
          agent_status: "idle",
        });
      },
      ["start", "baxter"],
      /already live in w1:p9/,
    ],
    [
      "full workspace",
      (s) => {
        s.env.herdr(["workspace", "create", "--label", "phase"]);
        const ws = s.fake.state.workspaces.at(-1)!.workspace_id!;
        for (let i = 0; i < 8; i++)
          s.env.herdr(["tab", "create", "--workspace", ws, "--label", `x${i}`]);
      },
      ["start", "baxter"],
      /already has 9 tabs/,
    ],
  ];
  for (const [name, arrange, args, error] of cases)
    await t.test(name, () => {
      const s = setup(FIRST_SET.filter((id) => id !== "plan"));
      arrange(s);
      const before = s.fake.mutations().length;
      assert.throws(() => main(args, s.env), error);
      assert.equal(s.fake.mutations().length, before);
      assert.equal(existsSync(s.checkpoint(args[1])), false);
    });
});

test("stop refuses a session that is not idle", async (t) => {
  for (const status of ["working", "blocked", "unknown"])
    await t.test(status, () => {
      const { env, fake } = setup();
      main(["start", "baxter"], env);
      fake.state.agents[0].agent_status = status;
      const before = fake.mutations().length;
      assert.throws(
        () => main(["stop", "baxter"], env),
        /stop only an idle session/,
      );
      assert.equal(fake.mutations().length, before);
    });
});

test("stop refuses a role tab that holds a second pane", () => {
  const { env, fake } = setup();
  main(["start", "baxter"], env);
  const tab = fake.state.tabs.find((t) => t.label === "idea")!;
  fake.state.panes.push({
    pane_id: "w2:p99",
    tab_id: tab.tab_id,
    workspace_id: tab.workspace_id,
    label: "you·shell",
  });
  assert.throws(() => main(["stop", "baxter"], env), /more than the role pane/);
});

test("stop exits an idle session and closes only its own tab", () => {
  const { env, fake, checkpoint } = setup();
  main(["start", "baxter"], env);
  main(["start", "design"], env);
  assert.equal(main(["stop", "baxter", "--plan"], env), 0);
  assert.equal(fake.state.agents.length, 2);
  assert.equal(main(["stop", "baxter"], env), 0);
  assert.deepEqual(
    fake.state.tabs.filter((t) => t.workspace_id !== "w1").map((t) => t.label),
    ["term", "design"],
  );
  assert.deepEqual(
    fake.state.agents.map((a) => a.name),
    ["design"],
  );
  assert.equal(existsSync(checkpoint("baxter")), true);
  assert.equal(main(["stop", "baxter"], env), 0);
});

#!/usr/bin/env node
/**
 * Advisory role sessions as ordinary Herdr panes (option B, 2026-10-10).
 *
 * A role session gets nothing beyond an ordinary `claude` session: no
 * credentials, runtime access or write grants. Its charter prompt is appended
 * to the system prompt and it keeps a checkpoint under ~/.ai/roles/<role>/.
 * Roles are keyed by the shared roles/catalogue.json, which this script only
 * reads; the sandboxed launcher (scripts/roe-role.ts, draft) pins that file.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HARNESS = "claude";
const MAX_TABS = 9;
const TERM_TAB = "term";
const TERM_PANE = "you·shell";
const IDLE = new Set(["idle", "done"]);

export type Role = {
  title: string;
  charter_id: string;
  kind: "phase" | "domain";
  section: string;
  workspace: string;
  tab: string;
};
export type Roster = { charter: string; roles: Record<string, Role> };
type Advisory = {
  schema_version: number;
  catalogue: string;
  authority: string;
  roles: Record<string, Omit<Role, "title">>;
};
type Catalogue = {
  schema_version: number;
  charter: string;
  roles: Record<string, { title: string }>;
};

type Workspace = { workspace_id: string; label: string };
type Tab = { tab_id: string; workspace_id: string; label: string };
type Pane = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  label?: string;
};
type Agent = {
  pane_id: string;
  tab_id: string;
  agent?: string | null;
  name?: string | null;
  agent_status?: string;
};
/** Runs one herdr CLI command and returns its parsed `.result`. */
export type Herdr = (args: string[]) => Record<string, unknown>;

export type Env = {
  source: string;
  home: string;
  cwd: string;
  herdr: Herdr;
  out: (line: string) => void;
  sleep: (ms: number) => void;
};

function fail(message: string): never {
  throw new Error(message);
}

const readJson = <T>(path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as T;

/** Advisory placement from roles/advisory.json, titles from the catalogue. */
export function loadRoster(source: string): Roster {
  const advisory = readJson<Advisory>(join(source, "roles/advisory.json"));
  if (advisory.schema_version !== 1) fail("unsupported advisory schema");
  if (advisory.authority !== "advisory")
    fail("advisory authority must be advisory");
  const catalogue = readJson<Catalogue>(join(source, advisory.catalogue));
  if (catalogue.schema_version !== 1) fail("unsupported role catalogue");
  const roles: Record<string, Role> = {};
  const places = new Set<string>();
  for (const [id, role] of Object.entries(advisory.roles)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) fail(`invalid role ID ${id}`);
    const entry = catalogue.roles[id] ?? fail(`${id} is not in the catalogue`);
    if (!/^(ph|dom)-[a-z]+$/.test(role.charter_id ?? ""))
      fail(`${id}: charter_id must name a charter row`);
    if (role.kind !== "phase" && role.kind !== "domain")
      fail(`${id}: kind must be phase or domain`);
    if (!/^[a-z]{2,6}$/.test(role.workspace))
      fail(`${id}: workspace must be 2-6 lowercase letters`);
    if (!/^[a-z0-9-]{1,8}$/.test(role.tab) || role.tab === TERM_TAB)
      fail(`${id}: tab must be at most 8 characters and not ${TERM_TAB}`);
    const place = `${role.workspace}/${role.tab}`;
    if (places.has(place)) fail(`${id}: ${place} is already used`);
    places.add(place);
    roles[id] = { ...role, title: entry.title };
  }
  return { charter: catalogue.charter, roles };
}

function roleFor(roster: Roster, id: string): Role {
  return roster.roles[id] ?? fail(`unknown role ${id}`);
}

export function paths(env: Env, id: string) {
  return {
    prompt: join(env.source, "roles/prompts", `${id}.md`),
    template: join(env.source, "roles/prompts/checkpoint-template.md"),
    checkpoint: join(env.home, ".ai/roles", id, "checkpoint.md"),
    results: join(env.home, ".ai/roles", id, "results"),
  };
}

export const paneLabel = (id: string) => `${id}·${HARNESS}`;

function only<T>(items: T[], what: string): T | undefined {
  if (items.length > 1) fail(`more than one ${what}; resolve by hand`);
  return items[0];
}

type Location = {
  workspace?: Workspace;
  tabCount: number;
  tab?: Tab;
  panes: Pane[];
  agent?: Agent;
  agents: Agent[];
};

function locate(env: Env, role: Role): Location {
  const workspaces = env.herdr(["workspace", "list"]).workspaces as Workspace[];
  const workspace = only(
    workspaces.filter((w) => w.label === role.workspace),
    `workspace labelled ${role.workspace}`,
  );
  const agents = (env.herdr(["agent", "list"]).agents as Agent[]).filter(
    (a) => a.agent,
  );
  if (!workspace) return { tabCount: 0, panes: [], agents };
  const id = workspace.workspace_id;
  const tabs = env.herdr(["tab", "list", "--workspace", id]).tabs as Tab[];
  const tab = only(
    tabs.filter((t) => t.label === role.tab),
    `tab labelled ${role.workspace}/${role.tab}`,
  );
  const panes = tab
    ? (env.herdr(["pane", "list", "--workspace", id]).panes as Pane[]).filter(
        (p) => p.tab_id === tab.tab_id,
      )
    : [];
  const agent = tab
    ? only(
        agents.filter((a) => a.tab_id === tab.tab_id),
        `agent in ${role.workspace}/${role.tab}`,
      )
    : undefined;
  return { workspace, tabCount: tabs.length, tab, panes, agent, agents };
}

function initialPrompt(id: string, checkpoint: string): string {
  return (
    `You are the ${id} role session. Read your checkpoint at ${checkpoint} ` +
    "first and keep it current. Then wait for a consultation request from " +
    "André or the initiative lead."
  );
}

export type Options = { plan: boolean; focus: boolean };

export function start(env: Env, id: string, options: Options): number {
  const role = roleFor(loadRoster(env.source), id);
  const p = paths(env, id);
  if (!existsSync(p.prompt))
    fail(`no charter prompt at ${p.prompt}; generate the role prompts first`);
  if (!existsSync(p.checkpoint) && !existsSync(p.template))
    fail(`no checkpoint template at ${p.template}`);

  const at = locate(env, role);
  const where = `${role.workspace}/${role.tab}`;
  if (at.tab) {
    if (at.agent?.agent !== HARNESS)
      fail(
        `${where} exists without a live ${HARNESS} agent; close that tab or start it by hand`,
      );
    if (options.focus && !options.plan)
      env.herdr(["agent", "focus", at.agent.pane_id]);
    env.out(
      `running: ${id} in ${where} (${at.agent.pane_id}, ${at.agent.agent_status ?? "unknown"}); not starting another`,
    );
    return 0;
  }
  const clash = at.agents.find((a) => a.name === id);
  if (clash) fail(`agent name ${id} is already live in ${clash.pane_id}`);
  if (at.tabCount >= MAX_TABS)
    fail(`workspace ${role.workspace} already has ${MAX_TABS} tabs`);

  const focus = options.focus ? "--focus" : "--no-focus";
  const steps: string[] = [];
  if (!at.workspace)
    steps.push(
      `create workspace ${role.workspace} with a ${TERM_TAB} tab (${TERM_PANE})`,
    );
  steps.push(`create tab ${where} with pane ${paneLabel(id)}`);
  if (!existsSync(p.results))
    steps.push(`create private results directory ${p.results}`);
  if (!existsSync(p.checkpoint))
    steps.push(`create checkpoint ${p.checkpoint} from the template`);
  steps.push(
    `start ${HARNESS} as agent ${id} with ${p.prompt} appended to the system prompt`,
  );
  if (options.plan) {
    for (const step of steps) env.out(`plan: ${step}`);
    return 0;
  }

  let workspaceId = at.workspace?.workspace_id;
  if (!workspaceId) {
    const made = env.herdr([
      "workspace",
      "create",
      "--cwd",
      env.cwd,
      "--label",
      role.workspace,
      "--no-focus",
    ]) as {
      workspace: Workspace;
      tab: Tab;
      root_pane: Pane;
    };
    workspaceId = made.workspace.workspace_id;
    env.herdr(["tab", "rename", made.tab.tab_id, TERM_TAB]);
    env.herdr(["pane", "rename", made.root_pane.pane_id, TERM_PANE]);
  }
  const made = env.herdr([
    "tab",
    "create",
    "--workspace",
    workspaceId,
    "--cwd",
    env.cwd,
    "--label",
    role.tab,
    focus,
  ]) as { tab: Tab; root_pane: Pane };
  const pane = made.root_pane.pane_id;
  env.herdr(["pane", "rename", pane, paneLabel(id)]);
  mkdirSync(p.results, { recursive: true, mode: 0o700 });
  if (!existsSync(p.checkpoint)) {
    writeFileSync(p.checkpoint, readFileSync(p.template), {
      mode: 0o600,
      flag: "wx",
    });
    chmodSync(p.checkpoint, 0o600);
  }
  env.herdr([
    "agent",
    "start",
    id,
    "--kind",
    HARNESS,
    "--pane",
    pane,
    "--",
    "--append-system-prompt-file",
    p.prompt,
    "--name",
    id,
    initialPrompt(id, p.checkpoint),
  ]);
  env.out(`started: ${id} in ${where} (${pane}); checkpoint ${p.checkpoint}`);
  return 0;
}

export function stop(env: Env, id: string, options: Options): number {
  const role = roleFor(loadRoster(env.source), id);
  const at = locate(env, role);
  const where = `${role.workspace}/${role.tab}`;
  if (!at.tab) {
    env.out(`not running: ${id} has no ${where} tab`);
    return 0;
  }
  const agent = at.agent;
  if (agent?.agent !== HARNESS)
    fail(`${where} has no live ${HARNESS} agent; close that tab by hand`);
  if (!IDLE.has(agent.agent_status ?? ""))
    fail(
      `refusing: ${id} is ${agent.agent_status ?? "unknown"}; stop only an idle session`,
    );
  if (at.panes.length !== 1 || at.panes[0].label !== paneLabel(id))
    fail(`${where} holds more than the role pane; close it by hand`);
  if (options.plan) {
    env.out(
      `plan: exit ${HARNESS} in ${agent.pane_id}, then close tab ${where}`,
    );
    return 0;
  }
  env.herdr(["pane", "run", agent.pane_id, "/exit"]);
  for (let i = 0; ; i++) {
    const live = (env.herdr(["agent", "list"]).agents as Agent[]).some(
      (a) => a.pane_id === agent.pane_id && a.agent,
    );
    if (!live) break;
    if (i >= 40)
      fail(`${id} did not exit; its tab is left open at ${agent.pane_id}`);
    env.sleep(250);
  }
  env.herdr(["tab", "close", at.tab.tab_id]);
  env.out(`stopped: ${id}; checkpoint kept at ${paths(env, id).checkpoint}`);
  return 0;
}

export function list(env: Env): number {
  const roster = loadRoster(env.source);
  for (const [id, role] of Object.entries(roster.roles)) {
    const ready = existsSync(paths(env, id).prompt) ? "prompt" : "no-prompt";
    env.out(`${id}\t${role.workspace}/${role.tab}\t${ready}\t${role.title}`);
  }
  return 0;
}

const USAGE =
  "usage: roe-advisory start|plan <role> [--focus] | roe-advisory stop <role> [--plan] | roe-advisory list";

export function main(args: string[], env: Env): number {
  const [action, ...rest] = args;
  const flags = rest.filter((a) => a.startsWith("-"));
  const positional = rest.filter((a) => !a.startsWith("-"));
  for (const flag of flags)
    if (flag !== "--plan" && flag !== "--focus") fail(`unknown option ${flag}`);
  const options = {
    plan: flags.includes("--plan"),
    focus: flags.includes("--focus"),
  };
  if (action === "list" && rest.length === 0) return list(env);
  if (positional.length !== 1) fail(USAGE);
  if (action === "start") return start(env, positional[0], options);
  if (action === "plan")
    return start(env, positional[0], { plan: true, focus: false });
  if (action === "stop" && !options.focus)
    return stop(env, positional[0], options);
  fail(USAGE);
}

function herdrCli(args: string[]): Record<string, unknown> {
  const run = spawnSync("herdr", args, { encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0)
    fail(
      `herdr ${args.slice(0, 2).join(" ")}: ${run.stderr.trim() || run.stdout.trim()}`,
    );
  return (JSON.parse(run.stdout) as { result: Record<string, unknown> }).result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    if (process.env.HERDR_ENV !== "1") fail("not running inside Herdr");
    process.exitCode = main(process.argv.slice(2), {
      source: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      home: homedir(),
      cwd: "/workspace",
      herdr: herdrCli,
      out: (line) => process.stdout.write(line + "\n"),
      sleep: (ms) =>
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    });
  } catch (error) {
    process.stderr.write(
      `roe-advisory: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

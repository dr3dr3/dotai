import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAll, sections, sync } from "../scripts/roe-advisory-prompts.ts";
import type { Sources } from "../scripts/roe-advisory-prompts.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHARTER = "reference/taxonomy-topology/ai-pilot-role-charters.md";

const fence = (body: string) => "```text\n" + body + "```";
/** A charter shaped like the real one, with recognisable marker text. */
function charter(overrides: Record<string, string | null> = {}): string {
  const parts: Record<string, string> = {
    "Activation, 2026-10-10 (option B)": "ACTIVATION advisory only.",
    "Shared charter": "SHARED rules.",
    "Phase leads": [
      "| Phase / role ID | Purpose and primary output | Consult when material |",
      "|---|---|---|",
      "| Idea / Baxter `ph-idea` | IDEA purpose | IDEA consult |",
      "| Design / `ph-design` | DESIGN purpose | DESIGN consult |",
      "| Plan / `ph-plan` | PLAN purpose | PLAN consult |",
    ].join("\n"),
    "Domain leads": [
      "Intro.",
      "",
      "| Role ID | Responsibility | Typical consultation result |",
      "|---|---|---|",
      "| `dom-standards` | STD resp | STD result |",
      "| `dom-quality` | QA resp | QA result |",
      "| `dom-security` | SEC resp | SEC result |",
      "",
      "COVERAGE paragraph.",
      "",
      "Security subtopics for the charter: SUBTOPICS.",
    ].join("\n"),
    "Initiative coordination": "INITIATIVE lead.",
    "Consultation request template":
      fence("Request ID and revision:\n") + "\n\nREQUEST rules.",
    "Consultation result template": fence(
      "Request ID/revision and responding role:\n",
    ),
    "Checkpoint template":
      fence("Role / instance / session pointer:\nNext safe action:\n") +
      "\n\nCHECKPOINT rules.",
  };
  let text = "# Charters\n";
  for (const [heading, body] of Object.entries({ ...parts, ...overrides }))
    if (body !== null) text += `\n## ${heading}\n\n${body}\n`;
  return text;
}
const contracts = [
  "## Phase exit criteria",
  "",
  "| Phase | Question | Proposed exit evidence |",
  "|---|---|---|",
  "| Idea | IDEA question? | IDEA evidence |",
  "| Design | DESIGN question? | DESIGN evidence |",
  "| Plan | PLAN question? | PLAN evidence |",
].join("\n");
function sources(text = charter(), exits = contracts): Sources {
  return {
    ref: "origin/main",
    charter: { path: CHARTER, blob: "a".repeat(40), text },
    contracts: { path: "contracts.md", blob: "b".repeat(40), text: exits },
  };
}

test("each role is told its own charter row, the activation rules and the templates", () => {
  const files = renderAll(REPO, sources());
  assert.deepEqual([...files.keys()].sort(), [
    "baxter.md",
    "checkpoint-template.md",
    "design.md",
    "plan.md",
    "quality.md",
    "security.md",
    "standards.md",
  ]);
  const baxter = files.get("baxter.md")!;
  assert.match(
    baxter,
    /^# Baxter — Idea Lead \(`baxter`, charter `ph-idea`\)/m,
  );
  assert.match(baxter, /IDEA purpose/);
  assert.match(baxter, /Exit question: IDEA question\?/);
  assert.doesNotMatch(baxter, /DESIGN purpose|SEC resp/);
  for (const marker of [
    "ACTIVATION advisory only.",
    "SHARED rules.",
    "INITIATIVE lead.",
    "REQUEST rules.",
    "CHECKPOINT rules.",
    "Request ID/revision and responding role:",
  ])
    for (const [name, text] of files)
      if (name !== "checkpoint-template.md")
        assert.ok(text.includes(marker), `${name} lacks ${marker}`);
  assert.match(baxter, /~\/\.ai\/roles\/baxter\/results\/<request-id>\.md/);
});

test("the security subtopics go to the Security lead only", () => {
  const files = renderAll(REPO, sources());
  assert.match(files.get("security.md")!, /SUBTOPICS/);
  assert.doesNotMatch(files.get("quality.md")!, /SUBTOPICS/);
  assert.match(files.get("quality.md")!, /COVERAGE paragraph/);
});

test("prompts are stamped with the source blobs they came from", () => {
  const files = renderAll(REPO, sources());
  assert.match(
    files.get("plan.md")!,
    new RegExp(`${CHARTER}@aaaaaaaaaaaa, contracts\\.md@bbbbbbbbbbbb`),
  );
  assert.doesNotMatch(
    files.get("security.md")!.split("\n")[0],
    /contracts\.md/,
  );
  assert.equal(
    files.get("checkpoint-template.md")!.split("\n").slice(1).join("\n"),
    "Role / instance / session pointer:\nNext safe action:\n",
  );
});

test("a charter that lost something the prompts need is refused", async (t) => {
  const cases: [string, Sources, RegExp][] = [
    [
      "no activation section",
      sources(charter({ "Activation, 2026-10-10 (option B)": null })),
      /starting "Activation"/,
    ],
    [
      "no checkpoint template",
      sources(charter({ "Checkpoint template": "prose only" })),
      /no ```text block/,
    ],
    [
      "no row for a role",
      sources(
        charter({
          "Phase leads":
            "| a | b | c |\n|---|---|---|\n| Idea / `ph-idea` | x | y |",
        }),
      ),
      /one charter row for ph-design/,
    ],
    [
      "two rows for one role",
      sources(
        charter({
          "Domain leads":
            "| a | b | c |\n|---|---|---|\n| `dom-quality` | x | y |\n| `dom-quality` | x2 | y2 |\n| `dom-security` | s | t |\n| `dom-standards` | u | v |",
        }),
      ),
      /one charter row for dom-quality, found 2/,
    ],
    [
      "no exit row for a phase",
      sources(charter(), contracts.replace(/\| Plan .*\n?/, "")),
      /one phase exit row for Plan/,
    ],
    [
      "duplicated section",
      sources(charter() + "\n## Shared charter\n\nagain\n"),
      /duplicate charter section/,
    ],
    [
      "a different charter from the catalogue's",
      { ...sources(), charter: { ...sources().charter, path: "other.md" } },
      /catalogue names charter/,
    ],
  ];
  for (const [name, input, error] of cases)
    await t.test(name, () =>
      assert.throws(() => renderAll(REPO, input), error),
    );
});

test("check reports drift without writing; generate then makes check clean", () => {
  const repo = mkdtempSync(join(tmpdir(), "roe-advisory-prompts-"));
  mkdirSync(join(repo, "roles"));
  for (const file of ["roles/advisory.json", "roles/catalogue.json"])
    cpSync(join(REPO, file), join(repo, file));
  const files = renderAll(repo, sources());
  assert.equal(sync(repo, files, false).length, 7);
  assert.equal(existsSync(join(repo, "roles/prompts")), false);
  assert.equal(sync(repo, files, true).length, 7);
  assert.deepEqual(sync(repo, files, false), []);
  const changed = renderAll(
    repo,
    sources(charter({ "Shared charter": "SHARED rules, revised." })),
  );
  assert.equal(sync(repo, changed, false).length, 6);
});

test("the committed prompts cover every advisory role and cite the catalogue's charter", () => {
  const advisory = JSON.parse(
    readFileSync(join(REPO, "roles/advisory.json"), "utf8"),
  );
  const committed = readdirSync(join(REPO, "roles/prompts")).sort();
  assert.deepEqual(
    committed,
    [
      ...Object.keys(advisory.roles).map((id) => `${id}.md`),
      "checkpoint-template.md",
    ].sort(),
  );
  for (const name of committed) {
    const text = readFileSync(join(REPO, "roles/prompts", name), "utf8");
    assert.match(
      text.split("\n")[0],
      new RegExp(
        `^<!-- Generated by scripts/roe-advisory-prompts\\.ts from ai-context origin/main: ${CHARTER}@[0-9a-f]{12}`,
      ),
    );
  }
  assert.ok(
    sections(readFileSync(join(REPO, "roles/prompts/baxter.md"), "utf8")).has(
      "Authority and working files",
    ),
  );
});

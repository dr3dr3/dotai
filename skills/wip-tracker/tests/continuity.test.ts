import test from "node:test";
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import {
  Store,
  ContinuityError,
  render,
  renderOutcomes,
  type Doc,
} from "../scripts/continuity.ts";
import { Fixture, id, TIME, content, action, observation } from "./support.ts";
const using = (name: string, fn: (f: Fixture) => void) =>
  test(name, () => {
    const f = new Fixture();
    try {
      fn(f);
    } finally {
      f.close();
    }
  });
using("exact replay is durable; changed event or sequence conflicts", (f) => {
  const h = f.send(),
    ev = f.event("accept", h.id, f.acceptPayload(h)),
    a = f.actor(f.receiver);
  const first = f.store.apply(ev, a);
  assert.equal(first.ok, true);
  assert.deepEqual(f.store.apply(ev, a), first);
  assert.throws(
    () =>
      f.store.apply(
        { ...ev, payload: { ...ev.payload, understanding: "changed" } },
        a,
      ),
    { code: "replay_conflict" },
  );
  assert.throws(() => f.store.apply({ ...ev, id: id() }, a), {
    code: "replay_conflict",
  });
  assert.equal(f.store.get("threads", f.thread).assignment_revision, 1);
});
using(
  "registration is idempotent and provider identity collision rejects",
  (f) => {
    const s = f.store.get("sessions", f.sender);
    const payload = Object.fromEntries(
      ["role", "environment", "launch_attempt", "profile", "identity"].map(
        (k) => [k, s[k]],
      ),
    );
    assert.equal(f.emit("register", f.sender, payload).id, f.sender);
    assert.equal(
      f.emit(
        "register",
        id(),
        { ...payload, launch_attempt: id() },
        null,
        false,
      ).code,
      "conflict",
    );
  },
);
using(
  "clarification, explicit acceptance and park preserve checkpoint",
  (f) => {
    let h = f.send();
    h = f.emit(
      "clarify",
      h.id,
      { revision: 1, expected_state_revision: 1, questions: ["Scope?"] },
      f.receiver,
    );
    h = f.emit(
      "send",
      h.id,
      {
        revision: 1,
        expected_state_revision: 2,
        resolution: {
          answer: "Records only",
          remaining_questions: [],
          direct_discussion: false,
          authority_resolved: true,
        },
      },
      f.sender,
    );
    f.accept(h);
    f.checkpoint(content("Review later"), {
      disposition: "parked",
      human_approval: "fixture",
    });
    f.store.close();
    f.store = new Store(f.path, true);
    const row = f.store.query(f.thread)[0];
    assert.equal(row.thread.coordinator, f.receiver);
    assert.equal(row.thread.disposition, "parked");
    assert.equal(row.checkpoint.content.next_action, "Review later");
    assert.equal(row.suggest_intake_closure, true);
  },
);
using(
  "receiver, previous coordinator and exact handoff revision are required",
  (f) => {
    const h = f.send(),
      payload = f.acceptPayload(h);
    assert.equal(
      f.emit("accept", h.id, payload, f.sender, false).code,
      "forbidden",
    );
    assert.equal(
      f.emit(
        "accept",
        h.id,
        { ...payload, previous_coordinator: f.receiver },
        f.receiver,
        false,
      ).code,
      "stale",
    );
    const revised = f.prepare({ handoff: h.id, revision: 1 });
    assert.equal(
      f.emit("accept", h.id, payload, f.receiver, false).code,
      "stale",
    );
    assert.equal(revised.revision, 2);
  },
);
using(
  "two acceptances and stale checkpoint writers cannot lose history",
  (f) => {
    const h = f.send(),
      payload = f.acceptPayload(h);
    f.accept(h);
    assert.equal(
      f.emit(
        "accept",
        h.id,
        { ...payload, checkpoint_id: id() },
        f.receiver,
        false,
      ).code,
      "stale",
    );
    const old = f.store.get("threads", f.thread);
    f.checkpoint();
    assert.equal(
      f.emit(
        "checkpoint",
        id(),
        {
          thread: f.thread,
          expected_revision: old.revision,
          assignment_revision: old.assignment_revision,
          content: content(),
        },
        f.receiver,
        false,
      ).code,
      "stale",
    );
    assert.equal(
      f.store.db.prepare("SELECT count(*) n FROM checkpoints").get()!.n,
      2,
    );
  },
);
for (const mode of ["collaboration", "facilitation", "service"] as const)
  using(`${mode} mode and exit condition survive acceptance`, (f) => {
    const h = f.send(f.prepare({ mode, exit: "Return actual exit evidence" }));
    f.accept(h);
    const row = f.store.query(f.thread)[0];
    assert.equal(row.engagement.mode, mode);
    assert.equal(row.engagement.exit_condition, "Return actual exit evidence");
    assert.equal(row.engagement_exit, null);
  });
using(
  "mode revision preserves accepted agreement and updates assignment",
  (f) => {
    f.accept();
    const t = f.store.get("threads", f.thread);
    const engagement = f.emit(
      "revise-engagement",
      id(),
      {
        thread: f.thread,
        expected_thread_revision: t.revision,
        expected_assignment_revision: t.assignment_revision,
        expected_engagement_revision: t.engagement_revision,
        mode: "facilitation",
        exit_condition: "Recipient demonstrates independent use",
        reason: "Human revised",
        authority: [{ type: "fixture", ref: "human" }],
      },
      f.receiver,
    );
    const row = f.store.query(f.thread)[0];
    assert.equal(row.engagement_history.length, 2);
    assert.equal(engagement.revision, 2);
    assert.equal(row.thread.assignment_revision, 2);
  },
);
using("closed thread without exit evidence does not prove exit", (f) => {
  f.accept();
  f.checkpoint(content(), { disposition: "closed", human_approval: "fixture" });
  const row = f.store.query(f.thread)[0];
  assert.match(row.issues.join(" "), /exit evidence missing/);
});
using("unmet exit remains visible after closure", (f) => {
  f.accept();
  const body = {
    ...content(),
    engagement_exit: {
      revision: 1,
      assessment: "unmet",
      evidence: [{ type: "fixture", ref: "check" }],
      remaining: "Gap remains",
      next_action: "Revisit",
    },
  };
  f.checkpoint(body, { disposition: "closed", human_approval: "fixture" });
  const row = f.store.query(f.thread)[0];
  assert.equal(row.engagement_exit.assessment, "unmet");
  assert.match(row.issues.join(" "), /exit not met/);
});
using("outcome links and scope revisions preserve multiple threads", (f) => {
  const outcome = f.outcome();
  const origin = f.open(outcome);
  const child = f.open(outcome, origin);
  assert.equal(f.store.get("threads", child).origin, origin);
  assert.equal(f.store.outcomeView(outcome)[0].threads.length, 2);
  const old = f.store.get("outcomes", outcome);
  f.emit(
    "outcome-scope",
    outcome,
    {
      expected_revision: old.revision,
      title: "Revised",
      conditions: [{ id: "new", text: "New scope" }],
      authority: [{ type: "fixture", ref: "revision" }],
      reason: "Agreed change",
    },
    f.sender,
  );
  assert.equal(f.store.outcomeView(outcome)[0].scope_history.length, 2);
});
using(
  "four independent conditions cannot complete from one supported fact",
  (f) => {
    const outcome = f.outcome(
      ["build", "test", "review", "release"].map((x) => ({ id: x, text: x })),
    );
    const thread = f.open(outcome);
    const t = f.store.get("threads", thread);
    f.emit(
      "checkpoint",
      id(),
      {
        thread,
        expected_revision: t.revision,
        assignment_revision: t.assignment_revision,
        content: {
          ...content(),
          scope_revision: 1,
          observations: [observation("build", "merged")],
          conditions: [
            { id: "build", state: "met", evidence: ["build"], remaining: "" },
          ],
        },
      },
      f.sender,
    );
    const view = f.store.outcomeView(outcome, TIME)[0];
    assert.deepEqual(
      view.conditions.map((x: Doc) => x.state),
      ["met", "unknown", "unknown", "unknown"],
    );
    assert.equal(
      f.emit(
        "complete-outcome",
        outcome,
        {
          expected_revision: 1,
          scope_revision: 1,
          acceptance_evidence: [{ type: "fixture", ref: "accept" }],
        },
        f.sender,
        false,
      ).code,
      "incomplete",
    );
  },
);
using(
  "newer correction removes false dependency while preserving hold",
  (f) => {
    const outcome = f.outcome(),
      thread = f.open(outcome);
    const t = f.store.get("threads", thread);
    f.emit(
      "checkpoint",
      id(),
      {
        thread,
        expected_revision: t.revision,
        assignment_revision: 0,
        content: {
          ...content(),
          actions: [action("do", "waiting", "proposed", ["dep"])],
          observations: [observation("dep", "blocked", { blocks: true })],
        },
      },
      f.sender,
    );
    let view = f.store.outcomeView(outcome, TIME)[0];
    assert.deepEqual(view.actions[0].waiting_for, ["dep"]);
    const next = f.store.get("threads", thread);
    f.emit(
      "checkpoint",
      id(),
      {
        thread,
        expected_revision: next.revision,
        assignment_revision: 0,
        content: {
          ...content(),
          actions: [action("do", "waiting", "proposed", ["dep"])],
          observations: [
            observation("dep", "unblocked", {
              blocks: false,
              observed_at: "2026-09-28T11:00:00Z",
              hold_reason: "Wait for handoff",
              release_condition: "Explicit clearance",
            }),
          ],
        },
      },
      f.sender,
    );
    view = f.store.outcomeView(outcome, TIME)[0];
    assert.deepEqual(view.actions[0].waiting_for, []);
    assert.equal(view.evidence.dep.hold_reason, "Wait for handoff");
  },
);
using(
  "same-time observations with optional field changes stay ambiguous",
  (f) => {
    const outcome = f.outcome([{ id: "done", text: "Done" }]);
    const thread = f.open(outcome);
    for (const observed of [
      observation("done", "accepted"),
      observation("done", "accepted", { blocks: true }),
    ]) {
      const t = f.store.get("threads", thread);
      f.emit(
        "checkpoint",
        id(),
        {
          thread,
          expected_revision: t.revision,
          assignment_revision: 0,
          content: {
            ...content(),
            scope_revision: 1,
            observations: [observed],
            conditions: [
              { id: "done", state: "met", evidence: ["done"], remaining: "" },
            ],
          },
        },
        f.sender,
      );
    }
    const view = f.store.outcomeView(outcome, TIME)[0];
    assert.equal(view.evidence.done.status, "unknown");
    assert.match(view.evidence.done.ambiguity, /Conflicting observations/);
    assert.equal(view.conditions[0].state, "unknown");
  },
);
using("optional follow-up does not extend completion line", (f) => {
  const outcome = f.outcome(),
    thread = f.open(outcome),
    t = f.store.get("threads", thread);
  f.emit(
    "checkpoint",
    id(),
    {
      thread,
      expected_revision: t.revision,
      assignment_revision: 0,
      content: {
        ...content(),
        actions: [action("later", "optional-follow-up")],
        scope_revision: 1,
        observations: [observation("done", "accepted")],
        conditions: [
          { id: "done", state: "met", evidence: ["done"], remaining: "" },
        ],
      },
    },
    f.sender,
  );
  const complete = f.emit(
    "complete-outcome",
    outcome,
    {
      expected_revision: 1,
      scope_revision: 1,
      acceptance_evidence: [{ type: "fixture", ref: "approval" }],
    },
    f.sender,
  );
  assert.equal(complete.completion.scope_revision, 1);
  const view = f.store.outcomeView(outcome, TIME)[0];
  assert.equal(view.completed, true);
  assert.equal(view.actions[0].category, "optional-follow-up");
  assert.match(renderOutcomes([view]), /Danny advisory view/);
});
using(
  "legacy single action remains readable; stale evidence becomes unknown",
  (f) => {
    const outcome = f.outcome(),
      thread = f.open(outcome);
    const t = f.store.get("threads", thread);
    f.emit(
      "checkpoint",
      id(),
      {
        thread,
        expected_revision: t.revision,
        assignment_revision: 0,
        content: {
          ...content(),
          scope_revision: 1,
          observations: [observation("done", "old")],
          conditions: [
            { id: "done", state: "met", evidence: ["done"], remaining: "" },
          ],
        },
      },
      f.sender,
    );
    const view = f.store.outcomeView(outcome, "2026-10-20T12:00:00Z")[0];
    assert.equal(view.conditions[0].state, "unknown");
    assert.equal(view.actions[0].id, "legacy");
  },
);
using(
  "read-only missing, wrong schema, corrupt and symlink paths refuse",
  (f) => {
    assert.throws(() => new Store(`${f.dir}/missing`), {
      code: "missing_store",
    });
    f.store.db.exec("PRAGMA user_version=99");
    assert.throws(() => new Store(f.path), { code: "schema" });
    f.store.db.exec("PRAGMA user_version=2");
    const corrupt = `${f.dir}/corrupt.sqlite3`;
    writeFileSync(corrupt, "not SQLite", { mode: 0o600 });
    assert.throws(() => new Store(corrupt));
    const linked = `${f.dir}/linked.sqlite3`;
    symlinkSync(f.path, linked);
    assert.throws(() => new Store(linked), { code: "unsafe_path" });
  },
);
using("inert launch request never returns fulfilled", (f) => {
  const request = id();
  const body = f.emit("launch-request", request, {
    thread: f.thread,
    handoff: null,
    role: "fixture",
    profile: "offline",
    mode: "create",
    session: null,
    sources: [],
    human_approval: "fixture",
  });
  assert.equal(body.inert, true);
  assert.equal(
    f.emit(
      "launch-result",
      request,
      { expected_revision: 0, result: "fulfilled", reason: "no" },
      null,
      false,
      TIME,
      "launcher",
    ).code,
    "invalid",
  );
});
const parallel = (data: any) =>
  new Promise<any>((resolve, reject) => {
    const worker = new Worker(
      new URL("./concurrency_worker.ts", import.meta.url),
      { workerData: data },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
  });
test("two independent workers cannot both accept same handoff revision", async () => {
  const f = new Fixture();
  try {
    const h = f.send(),
      payload = f.acceptPayload(h),
      e1 = f.event("accept", h.id, payload),
      e2 = f.event("accept", h.id, { ...payload, checkpoint_id: id() });
    const results = await Promise.all([
      parallel({
        path: f.path,
        kind: "accept",
        event: e1,
        actor: f.actor(f.receiver),
      }),
      parallel({
        path: f.path,
        kind: "accept",
        event: e2,
        actor: { ...f.actor(f.receiver), producer: "competing-receiver" },
      }),
    ]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    assert.equal(f.store.get("threads", f.thread).assignment_revision, 1);
  } finally {
    f.close();
  }
});
test("dated Production House fixture keeps four conditions and unresolved holds", () => {
  const f = new Fixture();
  try {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/production-house.json", import.meta.url),
        "utf8",
      ),
    );
    assert.match(fixture.notice, /Historical/);
    const outcome = f.outcome(fixture.conditions),
      thread = f.open(outcome),
      t = f.store.get("threads", thread);
    f.emit(
      "checkpoint",
      id(),
      {
        thread,
        expected_revision: t.revision,
        assignment_revision: 0,
        content: fixture.checkpoint,
      },
      f.sender,
    );
    const view = f.store.outcomeView(outcome, TIME)[0];
    assert.deepEqual(
      view.conditions.map((c: Doc) => c.state),
      ["gap", "unknown", "unknown", "unknown"],
    );
    assert.deepEqual(
      view.actions.find((a: Doc) => a.id === "qc-verify").waiting_for,
      ["ENG-3584"],
    );
    assert.deepEqual(
      view.actions.find((a: Doc) => a.id === "held-sso").waiting_for,
      ["SSO-286"],
    );
    assert.equal(
      view.actions.find((a: Doc) => a.id === "optional-guide").category,
      "optional-follow-up",
    );
    assert.equal(view.execution_authority, "none");
    const human = renderOutcomes([view]);
    assert.match(human, /Required deploy order remains in force/);
    assert.match(human, /Established deploy-order prerequisite verified/);
  } finally {
    f.close();
  }
});
test("CLI refuses missing store without initializing one", () => {
  const f = new Fixture();
  try {
    const missing = `${f.dir}/absent.sqlite`;
    const result = spawnSync(
      process.execPath,
      [
        new URL("../scripts/continuity_cli.ts", import.meta.url).pathname,
        "query",
        "--db",
        missing,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "missing_store");
    assert.equal(existsSync(missing), false);
  } finally {
    f.close();
  }
});
using("stale exit evidence is rejected after mode revision", (f) => {
  f.accept();
  const t = f.store.get("threads", f.thread);
  f.emit(
    "revise-engagement",
    id(),
    {
      thread: f.thread,
      expected_thread_revision: t.revision,
      expected_assignment_revision: t.assignment_revision,
      expected_engagement_revision: t.engagement_revision,
      mode: "collaboration",
      exit_condition: "Agree plan",
      reason: "Human revision",
      authority: [{ type: "fixture", ref: "decision" }],
    },
    f.receiver,
  );
  const cp = {
    ...content(),
    engagement_exit: {
      revision: 1,
      assessment: "met",
      evidence: [{ type: "fixture", ref: "old" }],
      remaining: "",
      next_action: "",
    },
  };
  assert.equal(
    f.emit(
      "checkpoint",
      id(),
      {
        thread: f.thread,
        expected_revision: 2,
        assignment_revision: 2,
        content: cp,
      },
      f.receiver,
      false,
    ).code,
    "stale",
  );
});
using(
  "exact typed links return candidate threads without merging records",
  (f) => {
    const first = f.open(),
      second = f.open();
    const payload = {
      title: "Linked candidate",
      outcome: "Look up",
      links: [{ type: "issue", ref: "ABC-123" }],
      coordinator: f.sender,
    };
    const third = id();
    f.emit("open", third, payload);
    const fourth = id();
    f.emit("open", fourth, payload);
    assert.deepEqual(
      f.store
        .query(undefined, { type: "issue", ref: "ABC-123" })
        .map((r) => r.thread.id)
        .sort(),
      [third, fourth].sort(),
    );
    assert.equal(
      f.store.query(undefined, { type: "issue", ref: "ABC-12" }).length,
      0,
    );
    assert.notEqual(first, second);
  },
);
using("direct-entry observation is evidence and cannot complete work", (f) => {
  const unknown = f.register(false),
    thread = f.open(undefined, undefined, unknown);
  const observed = f.emit(
    "observe",
    unknown,
    {
      expected_revision: 0,
      state: "exited",
      location: null,
      observed_at: TIME,
      source: "fixture observation",
    },
    null,
    true,
    TIME,
    "observer",
  );
  assert.equal(observed.observation.state, "exited");
  const row = f.store.query(thread)[0];
  assert.match(row.issues.join(" "), /identity\/resume reference unknown/);
  assert.equal(row.runtime_authority, "unchanged");
});

import test from "node:test";
import { Worker } from "node:worker_threads";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Store, all, one } from "../scripts/continuity.ts";
import {
  Feedback,
  FixtureOutbox,
  defaults,
} from "../scripts/continuity_feedback.ts";
import { Fixture, id, content } from "./support.ts";
function setup() {
  const f = new Fixture(),
    outcome = f.outcome(),
    thread = f.open(outcome),
    t = f.store.get("threads", thread);
  f.emit(
    "checkpoint",
    id(),
    {
      thread,
      expected_revision: t.revision,
      assignment_revision: 0,
      content: content(),
    },
    f.sender,
  );
  let time = 1000000;
  const clock = () => time,
    service = new Feedback(f.store, clock, true);
  const cp = f.store.get("threads", thread).checkpoint;
  let seq = 0;
  const event = (kind: string, payload: any) => ({
    id: id(),
    sequence: ++seq,
    kind,
    payload,
  });
  const claim = () =>
    event("claim", {
      request: id(),
      outcome,
      thread,
      checkpoint: cp,
      natural_pause: true,
      other_question_pending: false,
    });
  const submit = (e: any, session = f.sender, producer = "fixture-feedback") =>
    service.submit(e, session, producer);
  return {
    f,
    outcome,
    thread,
    cp,
    clock,
    service,
    claim,
    event,
    submit,
    setTime: (v: number) => {
      time = v;
    },
    advance: (v: number) => {
      time += v;
    },
  };
}
const using = (
  name: string,
  fn: (x: ReturnType<typeof setup>) => void | Promise<void>,
) =>
  test(name, async () => {
    const x = setup();
    try {
      await fn(x);
    } finally {
      x.f.close();
    }
  });
using("proposed defaults are disabled without opt-in simulation", (x) => {
  assert.equal(defaults.status, "proposed-disabled");
  assert.equal(
    new Feedback(x.f.store, x.clock).submit(x.claim(), x.f.sender, "default")
      .state,
    "omit",
  );
});
using("one claim consumes shared cooldown and one request per outcome", (x) => {
  const a = x.claim(),
    first = x.submit(a);
  assert.equal(first.state, "claimed");
  assert.equal(first.display_permitted, true);
  assert.equal(x.submit(x.claim()).state, "omit");
  const other = x.f.outcome(),
    thread = x.f.open(other),
    t = x.f.store.get("threads", thread);
  x.f.emit(
    "checkpoint",
    id(),
    {
      thread,
      expected_revision: t.revision,
      assignment_revision: 0,
      content: content(),
    },
    x.f.sender,
  );
  const b = x.event("claim", {
    request: id(),
    outcome: other,
    thread,
    checkpoint: x.f.store.get("threads", thread).checkpoint,
    natural_pause: true,
    other_question_pending: false,
  });
  assert.equal(x.submit(b).state, "omit");
  x.advance(86400);
  assert.equal(
    x.submit({ ...b, id: id(), sequence: b.sequence + 1 }).state,
    "claimed",
  );
});
using(
  "claim replay never permits a second display; expired unconfirmed becomes unknown",
  (x) => {
    const c = x.claim(),
      r = x.submit(c);
    assert.equal(r.display_permitted, true);
    assert.equal(x.submit(c).display_permitted, false);
    x.advance(601);
    assert.equal(x.service.maintain().expired_content, 0);
    assert.equal(
      one(
        x.f.store.db,
        "SELECT state FROM feedback_prompts WHERE id=?",
        c.payload.request,
      )?.state,
      "unknown",
    );
    assert.equal(
      x.submit(
        x.event("shown", { request: c.payload.request, outcome: x.outcome }),
      ).state,
      "not_saved",
    );
    assert.equal(x.submit(x.claim()).state, "omit");
  },
);
using("skip and silence are distinct and create no ratings", (x) => {
  const c = x.claim();
  x.submit(c);
  x.submit(
    x.event("shown", { request: c.payload.request, outcome: x.outcome }),
  );
  assert.equal(
    x.submit(
      x.event("skip", { request: c.payload.request, outcome: x.outcome }),
    ).state,
    "skipped",
  );
  assert.equal(all(x.f.store.db, "SELECT * FROM feedback_content").length, 0);
  assert.equal(x.submit(x.claim()).state, "omit");
});
using("spontaneous feedback is unrated and suppresses prompting", (x) => {
  const e = x.event("spontaneous", {
    outcome: x.outcome,
    thread: x.thread,
    checkpoint: x.cp,
    rating: null,
    quote: "Helpful",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  });
  assert.equal(x.submit(e).state, "spontaneous");
  assert.equal(
    JSON.parse(
      one(x.f.store.db, "SELECT body FROM feedback_content WHERE id=?", e.id)!
        .body,
    ).rating,
    null,
  );
  assert.equal(x.submit(x.claim()).state, "omit");
});
using("spoofed session and mismatched request cannot bind", (x) => {
  const c = x.claim();
  x.submit(c);
  assert.equal(
    x.submit(
      x.event("shown", { request: c.payload.request, outcome: x.outcome }),
      x.f.receiver,
    ).error,
    "binding",
  );
  assert.equal(
    x.submit(x.event("shown", { request: c.payload.request, outcome: id() }))
      .error,
    "binding",
  );
});
using("shown answer saves explicit rating and replay is idempotent", (x) => {
  const c = x.claim();
  x.submit(c);
  x.submit(
    x.event("shown", { request: c.payload.request, outcome: x.outcome }),
  );
  const a = x.event("answer", {
    request: c.payload.request,
    outcome: x.outcome,
    rating: "Mixed",
    quote: "Partial",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  });
  const result = x.submit(a);
  assert.equal(result.state, "answered");
  assert.deepEqual(x.submit(a), result);
  assert.equal(
    x.submit({ ...a, payload: { ...a.payload, rating: "Yes" } }).error,
    "replay_conflict",
  );
  assert.equal(all(x.f.store.db, "SELECT * FROM feedback_content").length, 1);
  assert.equal(
    all(x.f.store.db, "SELECT body FROM events").some((r) =>
      r.body.includes("Partial"),
    ),
    false,
  );
});
using("sensitive and oversized content fails without saving", (x) => {
  const base = {
    outcome: x.outcome,
    thread: x.thread,
    checkpoint: x.cp,
    rating: null,
    quote: "A",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  };
  assert.equal(
    x.submit(x.event("spontaneous", { ...base, context: "token: abc" })).error,
    "sensitive_content",
  );
  assert.equal(
    x.submit(x.event("spontaneous", { ...base, quote: "x".repeat(513) })).error,
    "invalid",
  );
  assert.equal(all(x.f.store.db, "SELECT * FROM feedback_content").length, 0);
});
using("write failure reports not saved and emits no false receipt", (x) => {
  const e = x.event("spontaneous", {
    outcome: x.outcome,
    thread: x.thread,
    checkpoint: x.cp,
    rating: null,
    quote: "A",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  });
  x.f.store.db.exec("PRAGMA query_only=ON");
  const result = x.submit(e);
  assert.equal(result.saved, false);
  assert.equal(result.state, "not_saved");
  assert.equal(result.error, "write_failed");
  x.f.store.db.exec("PRAGMA query_only=OFF");
  assert.equal(all(x.f.store.db, "SELECT * FROM feedback_receipts").length, 0);
});
using(
  "outbox expiry distinguishes acknowledged and lost pending capture",
  (x) => {
    const outbox = new FixtureOutbox(x.f.sender, "outbox");
    const a = x.claim(),
      b = x.event("claim", { ...a.payload, request: id() });
    outbox.enqueue(a, x.clock());
    outbox.enqueue(b, x.clock());
    outbox.collect(x.service, a.id);
    x.advance(86401);
    assert.equal(outbox.maintain(x.service).length, 0);
    assert.equal(outbox.rows.has(a.id), false);
    x.advance(7 * 86400);
    assert.equal(outbox.maintain(x.service)[0].state, "lost-capture");
  },
);
using(
  "bounded review requires owner authority and does not expose to Danny",
  (x) => {
    assert.throws(() => x.service.review("danny", 0, x.clock()), {
      code: "forbidden",
    });
    assert.throws(() => x.service.review("concierge", 0, x.clock()), {
      code: "invalid",
    });
    const review = x.service.review("concierge", x.clock() - 10, x.clock(), {
      approved_by: "owner",
      start: x.clock() - 10,
      end: x.clock(),
      purpose: "manual P4/P6",
    });
    assert.equal(review.coverage.live_adapters.length, 0);
    assert.match(review.coverage.limits, /No overall adoption rate/);
  },
);
using(
  "content retention leaves only non-content suppression and replay markers",
  (x) => {
    const e = x.event("spontaneous", {
      outcome: x.outcome,
      thread: x.thread,
      checkpoint: x.cp,
      rating: null,
      quote: "Delete me",
      context: "Fixture",
      interpretation: null,
      capability: null,
      evidence: [],
    });
    x.submit(e);
    x.advance(91 * 86400);
    x.service.maintain();
    assert.equal(all(x.f.store.db, "SELECT * FROM feedback_content").length, 0);
    assert.equal(
      one(
        x.f.store.db,
        "SELECT payload_hash FROM feedback_receipts WHERE id=?",
        e.id,
      )?.payload_hash,
      null,
    );
    assert.equal(x.submit(e).state, "suppressed");
    assert.equal(x.submit(x.claim()).state, "omit");
  },
);
using("owner deletion removes content and pending outbox copy", (x) => {
  const e = x.event("spontaneous", {
    outcome: x.outcome,
    thread: x.thread,
    checkpoint: x.cp,
    rating: null,
    quote: "Delete me",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  });
  x.submit(e);
  const outbox = new FixtureOutbox(x.f.sender, "outbox");
  outbox.enqueue(e, x.clock());
  const result = x.service.delete([e.id], "owner", { outboxes: [outbox] });
  assert.equal(result.deleted, 1);
  assert.equal(outbox.rows.size, 0);
  assert.equal(x.submit(e).state, "suppressed");
});
using("clock rollback omits capture instead of bypassing cooldown", (x) => {
  x.submit(x.claim());
  x.setTime(x.clock() - 1);
  assert.equal(x.submit(x.claim()).error, "clock");
});
using(
  "snapshot restore reapplies current deletion before exposure",
  async (x) => {
    const e = x.event("spontaneous", {
      outcome: x.outcome,
      thread: x.thread,
      checkpoint: x.cp,
      rating: null,
      quote: "Do not resurrect",
      context: "Fixture",
      interpretation: null,
      capability: null,
      evidence: [],
    });
    x.submit(e);
    const backup = `${x.f.dir}/backup.sqlite`;
    await x.service.backup(backup);
    x.service.delete([e.id], "owner");
    const target = `${x.f.dir}/restored.sqlite`;
    await x.service.restore(backup, target);
    const restored = new Store(target);
    try {
      assert.equal(
        all(restored.db, "SELECT * FROM feedback_content").length,
        0,
      );
      assert.equal(
        one(
          restored.db,
          "SELECT payload_hash FROM feedback_receipts WHERE id=?",
          e.id,
        )?.payload_hash,
        null,
      );
    } finally {
      restored.close();
    }
  },
);
using(
  "seven-day backup boundary refuses restore and purges tracked file",
  async (x) => {
    const backup = `${x.f.dir}/expiring.sqlite`;
    await x.service.backup(backup);
    x.advance(defaults.backup_seconds);
    const target = `${x.f.dir}/expired-restore.sqlite`;
    await assert.rejects(x.service.restore(backup, target), {
      code: "expired",
    });
    assert.equal(existsSync(target), false);
    assert.deepEqual(x.service.maintain().removed_backups, [backup]);
    assert.equal(existsSync(backup), false);
    assert.equal(all(x.f.store.db, "SELECT * FROM feedback_backups").length, 0);
  },
);
using("full identity purge blocks old work after restore", async (x) => {
  const e = x.event("spontaneous", {
    outcome: x.outcome,
    thread: x.thread,
    checkpoint: x.cp,
    rating: null,
    quote: "Erase identity",
    context: "Fixture",
    interpretation: null,
    capability: null,
    evidence: [],
  });
  x.submit(e);
  const backup = `${x.f.dir}/backup.sqlite`;
  await x.service.backup(backup);
  x.service.delete([e.id], "owner", { fullIdentityPurge: true });
  const target = `${x.f.dir}/restored.sqlite`;
  await x.service.restore(backup, target);
  const restored = new Store(target);
  try {
    assert.equal(all(restored.db, "SELECT * FROM feedback_content").length, 0);
    assert.equal(
      new Feedback(restored, x.clock, true).submit(x.claim(), x.f.sender, "new")
        .state,
      "omit",
    );
  } finally {
    restored.close();
  }
});
using(
  "delayed answer after accepted handoff stays bound to original outcome and checkpoint",
  (x) => {
    const c = x.claim();
    x.submit(c);
    x.submit(
      x.event("shown", { request: c.payload.request, outcome: x.outcome }),
    );
    x.submit(
      x.event("silence", { request: c.payload.request, outcome: x.outcome }),
    );
    const h = x.f.send(x.f.prepare({ thread: x.thread }));
    x.f.accept(h);
    const answer = {
      request: c.payload.request,
      outcome: x.outcome,
      rating: "Yes",
      quote: "Late answer",
      context: "Fixture",
      interpretation: null,
      capability: null,
      evidence: [],
    };
    assert.equal(
      x.submit(x.event("answer", { ...answer, outcome: id() }), x.f.receiver)
        .error,
      "binding",
    );
    const event = x.event("answer", answer);
    assert.equal(x.submit(event, x.f.receiver).state, "answered");
    const row = one(
      x.f.store.db,
      "SELECT body FROM feedback_content WHERE id=?",
      event.id,
    )!;
    assert.equal(JSON.parse(row.body).checkpoint, x.cp);
  },
);
using("expired original request cannot be rebound after retention", (x) => {
  const c = x.claim();
  x.submit(c);
  x.submit(
    x.event("shown", { request: c.payload.request, outcome: x.outcome }),
  );
  x.advance(90 * 86400);
  x.service.maintain();
  assert.equal(
    x.submit(
      x.event("answer", {
        request: c.payload.request,
        outcome: x.outcome,
        rating: "Yes",
        quote: "Late",
        context: "Fixture",
        interpretation: null,
        capability: null,
        evidence: [],
      }),
    ).saved,
    false,
  );
});
using("spontaneous feedback invalidates undisplayed claim", (x) => {
  const c = x.claim();
  x.submit(c);
  x.submit(
    x.event("spontaneous", {
      outcome: x.outcome,
      thread: x.thread,
      checkpoint: x.cp,
      rating: null,
      quote: "Spontaneous",
      context: "Fixture",
      interpretation: null,
      capability: null,
      evidence: [],
    }),
  );
  assert.equal(
    x.submit(
      x.event("shown", { request: c.payload.request, outcome: x.outcome }),
    ).error,
    "transition",
  );
});
using(
  "post-snapshot answer receipt never claims missing content was restored",
  async (x) => {
    const c = x.claim();
    x.submit(c);
    const backup = `${x.f.dir}/before.sqlite`;
    await x.service.backup(backup);
    x.submit(
      x.event("shown", { request: c.payload.request, outcome: x.outcome }),
    );
    const answer = x.event("answer", {
      request: c.payload.request,
      outcome: x.outcome,
      rating: "Yes",
      quote: "After snapshot",
      context: "Fixture",
      interpretation: null,
      capability: null,
      evidence: [],
    });
    assert.equal(x.submit(answer).saved, true);
    const target = `${x.f.dir}/restored.sqlite`;
    await x.service.restore(backup, target);
    const restored = new Store(target);
    try {
      const service = new Feedback(restored, x.clock, true);
      const replay = service.submit(answer, x.f.sender, "fixture-feedback");
      assert.equal(replay.state, "suppressed");
      assert.equal(replay.saved, false);
      assert.equal(
        all(restored.db, "SELECT * FROM feedback_content").length,
        0,
      );
    } finally {
      restored.close();
    }
  },
);
using("unrelated store lineage refuses restore", async (x) => {
  const backup = `${x.f.dir}/source.sqlite`;
  await x.service.backup(backup);
  const other = `${x.f.dir}/other.sqlite`;
  Store.initialize(other);
  const store = new Store(other);
  try {
    await assert.rejects(
      () =>
        new Feedback(store, x.clock).restore(backup, `${x.f.dir}/bad.sqlite`),
      { code: "lineage" },
    );
  } finally {
    store.close();
  }
});
test("two independent workers claim one outcome only once", async () => {
  const x = setup();
  try {
    const a = x.claim(),
      b = x.claim();
    const results = await Promise.all([
      parallelClaim({
        path: x.f.path,
        kind: "claim",
        event: a,
        time: x.clock(),
        session: x.f.sender,
        producer: "collector-a",
      }),
      parallelClaim({
        path: x.f.path,
        kind: "claim",
        event: b,
        time: x.clock(),
        session: x.f.sender,
        producer: "collector-b",
      }),
    ]);
    assert.deepEqual(results.map((r) => r.state).sort(), ["claimed", "omit"]);
  } finally {
    x.f.close();
  }
});
const parallelClaim = (data: any) =>
  new Promise<any>((resolve, reject) => {
    const worker = new Worker(
      new URL("./concurrency_worker.ts", import.meta.url),
      { workerData: data },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
  });

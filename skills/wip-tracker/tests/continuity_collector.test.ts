import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import {
  Collector,
  bindingFile,
  instructions,
} from "../scripts/continuity_collector.ts";
import { canonical, all } from "../scripts/continuity.ts";
import { Fixture, id, content } from "./support.ts";
function setup() {
  const f = new Fixture(),
    outbox = `${f.dir}/outbox`,
    inbox = `${f.dir}/inbox`;
  mkdirSync(outbox, { mode: 0o700 });
  mkdirSync(inbox, { mode: 0o700 });
  const binding = {
    version: 1,
    session: f.sender,
    producer: "bound-producer",
    outbox,
    inbox,
    grants: [{ thread: f.thread, assignment_revision: 0 }],
  };
  const collector = new Collector(f.store, binding);
  const write = (event: any, raw = canonical(event)) => {
    const path = `${outbox}/${event.id}.json`;
    writeFileSync(path, raw, { mode: 0o600 });
    return path;
  };
  return { f, outbox, inbox, binding, collector, write };
}
const using = (name: string, fn: (x: ReturnType<typeof setup>) => void) =>
  test(name, () => {
    const x = setup();
    try {
      fn(x);
    } finally {
      x.f.close();
    }
  });
using("checkpoint commits once and repeat gets same durable receipt", (x) => {
  const t = x.f.store.get("threads", x.f.thread),
    ev = x.f.event("checkpoint", id(), {
      thread: x.f.thread,
      expected_revision: t.revision,
      assignment_revision: 0,
      content: content(),
    });
  x.write(ev);
  const first = x.collector.collect()[0];
  assert.deepEqual(first, {
    event: ev.id,
    committed: true,
    ok: true,
    code: "accepted",
  });
  assert.deepEqual(
    JSON.parse(readFileSync(`${x.inbox}/${ev.id}.json`, "utf8")),
    first,
  );
  assert.deepEqual(x.collector.collect()[0], first);
  assert.equal(all(x.f.store.db, "SELECT * FROM checkpoints").length, 1);
  assert.match(instructions(x.binding), /No database reads/);
});
using("child cannot add actor metadata or ungranted thread", (x) => {
  const thread = x.f.open(),
    t = x.f.store.get("threads", thread),
    ev = x.f.event("checkpoint", id(), {
      thread,
      expected_revision: t.revision,
      assignment_revision: 0,
      content: content(),
    }) as any;
  ev.actor = { producer: "spoof", kind: "operator", session: x.f.sender };
  x.write(ev);
  assert.equal(x.collector.collect()[0].committed, false);
  assert.equal(all(x.f.store.db, "SELECT * FROM checkpoints").length, 0);
});
using("ungranted thread is rejected in same event transaction", (x) => {
  const thread = x.f.open(),
    ev = x.f.event("checkpoint", id(), {
      thread,
      expected_revision: 0,
      assignment_revision: 0,
      content: content(),
    });
  x.write(ev);
  assert.equal(x.collector.collect()[0].code, "forbidden");
  assert.equal(all(x.f.store.db, "SELECT * FROM checkpoints").length, 0);
});
using("receiver needs exact handoff grant and previous assignment", (x) => {
  const h = x.f.send();
  const accept = x.f.event("accept", h.id, x.f.acceptPayload(h));
  const receiver = {
    ...x.binding,
    session: x.f.receiver,
    producer: "receiver",
    grants: [
      {
        thread: x.f.thread,
        assignment_revision: 0,
        handoff: h.id,
        handoff_revision: 1,
      },
    ],
  };
  const target = new Collector(x.f.store, receiver);
  x.write(accept);
  assert.equal(target.collect()[0].code, "accepted");
  assert.equal(x.f.store.get("threads", x.f.thread).coordinator, x.f.receiver);
  const old = x.f.event("checkpoint", id(), {
    thread: x.f.thread,
    expected_revision: 1,
    assignment_revision: 0,
    content: content(),
  });
  x.write(old);
  assert.equal(
    x.collector.collect().find((r) => r.event === old.id)?.code,
    "forbidden",
  );
});
using("feedback family never reaches general journal", (x) => {
  const ev = x.f.event("answer", id(), { anything: "raw" });
  x.write(ev);
  assert.equal(x.collector.collect()[0].committed, false);
  assert.equal(
    all(x.f.store.db, "SELECT * FROM events WHERE id=?", ev.id).length,
    0,
  );
});
using("producer sequence orders dependent checkpoint files", (x) => {
  const first = x.f.event("checkpoint", id(), {
      thread: x.f.thread,
      expected_revision: 0,
      assignment_revision: 0,
      content: content("first"),
    }),
    second = x.f.event("checkpoint", id(), {
      thread: x.f.thread,
      expected_revision: 1,
      assignment_revision: 0,
      content: content("second"),
    });
  x.write(second);
  x.write(first);
  assert.deepEqual(
    x.collector.collect().map((r) => r.code),
    ["accepted", "accepted"],
  );
  assert.equal(x.f.store.get("threads", x.f.thread).revision, 2);
});
using(
  "duplicate JSON key and noncanonical payload reject before commit",
  (x) => {
    const ev = x.f.event("checkpoint", id(), {
      thread: x.f.thread,
      expected_revision: 0,
      assignment_revision: 0,
      content: content(),
    });
    x.write(ev, canonical(ev).replace(/("sequence":\d+)/, '$1,"sequence":999'));
    const receipt = x.collector.collect()[0];
    assert.equal(receipt.committed, false);
    assert.equal(receipt.code, "invalid");
    assert.equal(
      all(x.f.store.db, "SELECT * FROM events WHERE id=?", ev.id).length,
      0,
    );
  },
);
using("symlink outbox event is not opened", (x) => {
  const ev = x.f.event("checkpoint", id(), {
    thread: x.f.thread,
    expected_revision: 0,
    assignment_revision: 0,
    content: content(),
  });
  const target = `${x.f.dir}/target`;
  writeFileSync(target, canonical(ev), { mode: 0o600 });
  symlinkSync(target, `${x.outbox}/${ev.id}.json`);
  const receipt = x.collector.collect()[0];
  assert.equal(receipt.committed, false);
  assert.equal(
    all(x.f.store.db, "SELECT * FROM events WHERE id=?", ev.id).length,
    0,
  );
});
using("failed receipt publication leaves committed event replayable", (x) => {
  const ev = x.f.event("checkpoint", id(), {
    thread: x.f.thread,
    expected_revision: 0,
    assignment_revision: 0,
    content: content(),
  });
  x.write(ev);
  mkdirSync(`${x.inbox}/${ev.id}.json`);
  assert.throws(() => x.collector.collect());
  assert.equal(all(x.f.store.db, "SELECT * FROM checkpoints").length, 1);
  rmSync(`${x.inbox}/${ev.id}.json`, { recursive: true });
  assert.equal(x.collector.collect()[0].code, "accepted");
  assert.equal(all(x.f.store.db, "SELECT * FROM checkpoints").length, 1);
});
using(
  "binding refuses channels containing database and foreign thread",
  (x) => {
    assert.throws(
      () => new Collector(x.f.store, { ...x.binding, outbox: x.f.dir }),
      { code: "unsafe_path" },
    );
    assert.throws(
      () =>
        new Collector(x.f.store, {
          ...x.binding,
          grants: [{ thread: id(), assignment_revision: 0 }],
        }),
      { code: "not_found" },
    );
  },
);

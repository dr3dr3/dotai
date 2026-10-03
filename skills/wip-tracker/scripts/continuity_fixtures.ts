/** Inert local demo: all identities, handoffs and observations are invented. */
import { chmodSync, mkdtempSync } from "node:fs";
import { Store, type Actor, type Event, render } from "./continuity.ts";
import { randomUUID } from "node:crypto";
const dir = mkdtempSync("/tmp/concierge-demo-");
chmodSync(dir, 0o700);
const path = `${dir}/store.sqlite`;
Store.initialize(path);
const store = new Store(path);
let sequence = 0;
const operator: Actor = {
  producer: "demo-operator",
  kind: "operator",
  session: null,
};
function apply(kind: string, subject: string, payload: any, actor = operator) {
  const event: Event = {
    id: randomUUID(),
    sequence: sequence++,
    kind,
    subject,
    time: new Date().toISOString(),
    payload,
  };
  const result = store.apply(event, actor);
  if (!result.ok) throw new Error(`${kind}: ${result.error.code}`);
  return result.value;
}
try {
  const first = randomUUID(),
    second = randomUUID(),
    thread = randomUUID();
  for (const [id, role] of [
    [first, "Concierge"],
    [second, "Firstmate"],
  ])
    apply("register", id, {
      role,
      environment: "fixture",
      launch_attempt: randomUUID(),
      profile: "offline",
      identity: null,
    });
  apply("open", thread, {
    title: "Parked handoff demo",
    outcome: "Find the next owner",
    links: [],
    coordinator: first,
  });
  const sender: Actor = {
      producer: "demo-first",
      kind: "session",
      session: first,
    },
    receiver: Actor = {
      producer: "demo-second",
      kind: "session",
      session: second,
    };
  const handoff = randomUUID();
  apply(
    "prepare",
    handoff,
    {
      thread,
      expected_thread_revision: 0,
      receiver: second,
      brief: {
        ref: "demo",
        outcome: "Record next step",
        sources: [],
        decisions: [],
        scope: "fixture",
        exclusions: "no execution",
        next_action: "Check the evidence",
        destination: "receiver",
        mode: "service",
        exit_condition: "Return verified destination or explicit unknown",
      },
      authority: "fixture approval",
      expected_handoff_revision: 0,
    },
    sender,
  );
  apply(
    "send",
    handoff,
    { revision: 1, expected_state_revision: 0, resolution: null },
    sender,
  );
  const content = {
    position: "Accepted offline fixture",
    decisions: [],
    evidence: [],
    questions: [],
    blockers: [],
    next_action: "Review later",
  };
  apply(
    "accept",
    handoff,
    {
      revision: 1,
      expected_state_revision: 1,
      expected_thread_revision: 0,
      previous_coordinator: first,
      checkpoint_id: randomUUID(),
      content,
      understanding: "Review later; no launch",
    },
    receiver,
  );
  console.log(render(store.query(thread)));
} finally {
  store.close();
}

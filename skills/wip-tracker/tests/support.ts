import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  Store,
  type Actor,
  type Event,
  type Doc,
} from "../scripts/continuity.ts";
export const id = randomUUID;
export const TIME = "2026-09-28T12:00:00Z";
export const content = (next = "Inspect evidence"): Doc => ({
  position: "Fixture work checkpointed",
  next_action: next,
  decisions: [],
  evidence: [],
  questions: [],
  blockers: [],
});
export const action = (
  name: string,
  category = "required-now",
  actor = "proposed",
  dependencies: string[] = [],
): Doc => ({
  id: name,
  text: name,
  category,
  actor: {
    status: actor,
    name: actor === "unknown" ? null : "André",
    evidence:
      actor === "confirmed" ? [{ type: "fixture", ref: "assignment" }] : [],
  },
  destination: { status: "unknown", session: null },
  dependencies,
  evidence: [],
  contribution: "Finish agreed condition",
});
export const observation = (
  key: string,
  claim: string,
  extra: Doc = {},
): Doc => ({
  key,
  claim,
  observed_at: "2026-09-28T10:00:00Z",
  source: { type: "fixture", ref: key },
  status: "supported",
  ...extra,
});
export class Fixture {
  readonly dir: string;
  readonly path: string;
  store: Store;
  sequence = 0;
  sender: string;
  receiver: string;
  thread: string;
  constructor() {
    this.dir = mkdtempSync("/tmp/concierge-ts-test-");
    chmodSync(this.dir, 0o700);
    this.path = `${this.dir}/continuity.sqlite3`;
    Store.initialize(this.path);
    this.store = new Store(this.path);
    this.sender = this.register();
    this.receiver = this.register();
    this.thread = this.open();
  }
  close(): void {
    this.store.close();
    rmSync(this.dir, { recursive: true, force: true });
  }
  actor(
    session: string | null = null,
    kind: Actor["kind"] = session ? "session" : "operator",
  ): Actor {
    return {
      producer: `fixture:${kind}:${session ?? "trusted"}`,
      kind,
      session,
    };
  }
  event(kind: string, subject: string, payload: Doc, time = TIME): Event {
    return {
      id: id(),
      sequence: ++this.sequence,
      kind,
      subject,
      time,
      payload,
    };
  }
  emit(
    kind: string,
    subject: string,
    payload: Doc,
    session: string | null = null,
    expected = true,
    time = TIME,
    producerKind?: Actor["kind"],
  ): Doc {
    const result = this.store.apply(
      this.event(kind, subject, payload, time),
      this.actor(session, producerKind),
    );
    if (result.ok !== expected) throw new Error(JSON.stringify(result));
    return expected ? result.value : result.error;
  }
  register(identity = true): string {
    const session = id();
    this.emit("register", session, {
      role: "fixture-worker",
      environment: "inert-c1",
      launch_attempt: id(),
      profile: "fixture-only",
      identity: identity
        ? {
            provider: "fixture",
            session_id: id(),
            resume_ref: "fixture://no-launch",
            evidence: "inert fixture identity",
          }
        : null,
    });
    return session;
  }
  open(outcome?: string, origin?: string, coordinator = this.sender): string {
    const thread = id(),
      payload: Doc = {
        title: "Thinking without a ticket",
        outcome: "Reach evidenced decision",
        links: [],
        coordinator,
      };
    if (outcome) payload.outcome_id = outcome;
    if (origin) payload.origin = origin;
    this.emit("open", thread, payload);
    return thread;
  }
  prepare(
    options: {
      thread?: string;
      handoff?: string;
      revision?: number;
      receiver?: string;
      mode?: string;
      exit?: string;
    } = {},
  ): Doc {
    const thread = options.thread ?? this.thread,
      t = this.store.get("threads", thread);
    return this.emit(
      "prepare",
      options.handoff ?? id(),
      {
        thread,
        expected_thread_revision: t.revision,
        receiver: options.receiver ?? this.receiver,
        brief: {
          ref: "fixture://brief",
          outcome: "Reach decision",
          sources: [],
          decisions: [],
          scope: "Inert records",
          exclusions: "All execution",
          next_action: "Inspect fixture",
          destination: "fixture receiver",
          mode: options.mode ?? "service",
          exit_condition:
            options.exit ?? "A verified destination or explicit unknown",
        },
        authority: "Record-only fixture",
        expected_handoff_revision: options.revision ?? 0,
      },
      t.coordinator,
    );
  }
  send(h = this.prepare()): Doc {
    return this.emit(
      "send",
      h.id,
      {
        revision: h.revision,
        expected_state_revision: h.state_revision,
        resolution: null,
      },
      h.sender,
    );
  }
  acceptPayload(h: Doc): Doc {
    const t = this.store.get("threads", h.thread);
    return {
      revision: h.revision,
      expected_state_revision: h.state_revision,
      expected_thread_revision: t.revision,
      previous_coordinator: h.sender,
      checkpoint_id: id(),
      content: content(),
      understanding: "Inert acceptance only",
    };
  }
  accept(h = this.send()): Doc {
    return this.emit("accept", h.id, this.acceptPayload(h), h.receiver);
  }
  checkpoint(body: Doc = content(), extra: Doc = {}): Doc {
    const t = this.store.get("threads", this.thread);
    return this.emit(
      "checkpoint",
      id(),
      {
        thread: t.id,
        expected_revision: t.revision,
        assignment_revision: t.assignment_revision,
        content: body,
        ...extra,
      },
      t.coordinator,
    );
  }
  outcome(conditions: Doc[] = [{ id: "done", text: "Done" }]): string {
    const result = id();
    this.emit(
      "outcome-scope",
      result,
      {
        expected_revision: 0,
        title: "Fixture outcome",
        conditions,
        authority: [{ type: "fixture", ref: "approved" }],
        reason: "Fixture scope",
      },
      this.sender,
    );
    return result;
  }
}

/** Offline feedback protocol. Proposed settings are disabled for live use. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  canonical,
  check,
  fields,
  integer,
  one,
  all,
  run,
  text,
  uuid,
  type Doc,
  type Store,
} from "./continuity.ts";
export const defaults = {
  status: "proposed-disabled",
  cooldown_seconds: 86400,
  unconfirmed_seconds: 600,
  feedback_seconds: 90 * 86400,
  quote_chars: 512,
  context_bytes: 2048,
  acknowledged_outbox_seconds: 86400,
  pending_outbox_seconds: 7 * 86400,
  diagnostic_seconds: 30 * 86400,
  backup_seconds: 7 * 86400,
};
export const feedbackSchema = `
CREATE TABLE feedback_control(id INTEGER PRIMARY KEY CHECK(id=1),last_claim REAL,last_clock REAL,omit_all INTEGER NOT NULL DEFAULT 0,settings TEXT NOT NULL);
CREATE TABLE feedback_prompts(id TEXT PRIMARY KEY,outcome TEXT NOT NULL UNIQUE REFERENCES outcomes(id),thread TEXT NOT NULL REFERENCES threads(id),checkpoint TEXT NOT NULL REFERENCES checkpoints(id),session TEXT NOT NULL REFERENCES sessions(id),claimed REAL NOT NULL,state TEXT NOT NULL,shown REAL,terminal REAL);
CREATE TABLE feedback_content(id TEXT PRIMARY KEY,outcome TEXT NOT NULL REFERENCES outcomes(id),request TEXT,thread TEXT NOT NULL REFERENCES threads(id),session TEXT NOT NULL REFERENCES sessions(id),received REAL NOT NULL,body TEXT NOT NULL);
CREATE TABLE feedback_receipts(id TEXT PRIMARY KEY,producer TEXT NOT NULL,sequence INTEGER NOT NULL,outcome TEXT,request TEXT,content TEXT,payload_hash TEXT,result TEXT NOT NULL,received REAL NOT NULL,UNIQUE(producer,sequence));
CREATE TABLE feedback_suppression(outcome TEXT PRIMARY KEY);CREATE TABLE feedback_deleted(id TEXT PRIMARY KEY);CREATE TABLE feedback_diagnostics(id TEXT PRIMARY KEY,received REAL NOT NULL,code TEXT NOT NULL);CREATE TABLE feedback_backups(path TEXT PRIMARY KEY,created REAL NOT NULL);CREATE TABLE store_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO feedback_control(id,settings) VALUES(1,'${canonical(defaults)}');`;
export class FeedbackError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
function ensure(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new FeedbackError(code, message);
}
const exact = (value: unknown, keys: string[]): void => {
  ensure(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid",
    "Expected object",
  );
  ensure(
    Object.keys(value as object)
      .sort()
      .join(",") === keys.sort().join(","),
    "invalid",
    "Unexpected feedback fields",
  );
};
const validUuid = (v: unknown): void => {
  try {
    uuid(v);
  } catch {
    throw new FeedbackError("invalid", "Expected UUID");
  }
};
const validText = (v: unknown): void => {
  try {
    text(v);
  } catch {
    throw new FeedbackError("invalid", "Expected text");
  }
};
export class Feedback {
  readonly db: DatabaseSync;
  readonly settings: typeof defaults;
  readonly store: Store;
  readonly clock: () => number;
  readonly simulate: boolean;
  constructor(
    store: Store,
    clock: () => number = () => Date.now() / 1000,
    simulate = false,
  ) {
    this.store = store;
    this.clock = clock;
    this.simulate = simulate;
    this.db = store.db;
    this.settings = JSON.parse(
      one(this.db, "SELECT settings FROM feedback_control WHERE id=1")!
        .settings,
    );
  }
  record(family: string, id: string): Doc {
    try {
      return this.store.get(family, id);
    } catch (e: any) {
      throw new FeedbackError(
        e.code ?? "invalid",
        "Context record unavailable",
      );
    }
  }
  time(): number {
    const current = this.clock(),
      control = one(this.db, "SELECT * FROM feedback_control WHERE id=1")!;
    ensure(
      Number.isFinite(current) && current >= 0 && current < 1e12,
      "clock",
      "Trusted time unavailable",
    );
    ensure(
      control.last_clock === null || current >= control.last_clock,
      "clock",
      "Clock rollback: omit prompt",
    );
    run(
      this.db,
      "UPDATE feedback_control SET last_clock=? WHERE id=1",
      current,
    );
    return current;
  }
  context(
    outcome: string,
    thread: string,
    checkpoint: string,
    session: string,
  ): Doc {
    for (const v of [outcome, thread, checkpoint, session]) validUuid(v);
    this.record("outcomes", outcome);
    const t = this.record("threads", thread),
      cp = this.record("checkpoints", checkpoint);
    ensure(
      t.outcome_id === outcome && cp.thread === thread,
      "binding",
      "Wrong outcome/thread binding",
    );
    ensure(t.coordinator === session, "binding", "Contributor not assigned");
    return t;
  }
  submit(envelope: Doc, boundSession: string, producer: string): Doc {
    try {
      exact(envelope, ["id", "sequence", "kind", "payload"]);
      validUuid(envelope.id);
      validUuid(boundSession);
      validText(producer);
      ensure(
        Number.isSafeInteger(envelope.sequence) && envelope.sequence >= 0,
        "invalid",
        "Bad sequence",
      );
      ensure(
        envelope.payload &&
          typeof envelope.payload === "object" &&
          !Array.isArray(envelope.payload),
        "invalid",
        "Expected payload",
      );
      ensure(
        Buffer.byteLength(canonical(envelope)) <= 8192,
        "invalid",
        "Oversized feedback",
      );
      this.record("sessions", boundSession);
      const fingerprint = createHash("sha256")
        .update(canonical([envelope, boundSession, producer]))
        .digest("hex");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const prior = all(
          this.db,
          "SELECT * FROM feedback_receipts WHERE id=? OR (producer=? AND sequence=?)",
          envelope.id,
          producer,
          envelope.sequence,
        );
        if (prior.length) {
          ensure(
            prior.length === 1 &&
              prior[0].id === envelope.id &&
              prior[0].producer === producer,
            "replay_conflict",
            "Feedback identity collision",
          );
          let result: Doc;
          if (prior[0].payload_hash === null)
            result = { ok: true, saved: false, state: "suppressed" };
          else {
            ensure(
              prior[0].payload_hash === fingerprint,
              "replay_conflict",
              "Mismatched replay",
            );
            result = JSON.parse(prior[0].result);
            if (envelope.kind === "claim") result.display_permitted = false;
          }
          this.db.exec("COMMIT");
          return result;
        }
        if (
          one(this.db, "SELECT 1 FROM feedback_deleted WHERE id=?", envelope.id)
        ) {
          this.db.exec("COMMIT");
          return { ok: true, saved: false, state: "suppressed" };
        }
        const current = this.time(),
          [result, outcome, request, content] = this.dispatch(
            envelope,
            boundSession,
            current,
          );
        run(
          this.db,
          "INSERT INTO feedback_receipts VALUES(?,?,?,?,?,?,?,?,?)",
          envelope.id,
          producer,
          envelope.sequence,
          outcome,
          request,
          content,
          fingerprint,
          canonical(result),
          current,
        );
        run(
          this.db,
          "INSERT INTO feedback_diagnostics VALUES(?,?,?)",
          envelope.id,
          current,
          result.state,
        );
        this.db.exec("COMMIT");
        return result;
      } catch (e) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
        throw e;
      }
    } catch (e: any) {
      return {
        ok: false,
        saved: false,
        state: "not_saved",
        error:
          e instanceof FeedbackError
            ? e.code
            : e.code === "ERR_SQLITE_ERROR" || e.code?.startsWith?.("SQLITE_")
              ? "write_failed"
              : "invalid",
      };
    }
  }
  dispatch(
    e: Doc,
    session: string,
    current: number,
  ): [Doc, string, string | null, string | null] {
    const p = e.payload,
      id = e.id,
      kind = e.kind;
    if (kind === "claim") {
      exact(p, [
        "request",
        "outcome",
        "thread",
        "checkpoint",
        "natural_pause",
        "other_question_pending",
      ]);
      validUuid(p.request);
      ensure(
        typeof p.natural_pause === "boolean" &&
          typeof p.other_question_pending === "boolean",
        "invalid",
        "Unknown pause state",
      );
      this.context(p.outcome, p.thread, p.checkpoint, session);
      const control = one(
          this.db,
          "SELECT * FROM feedback_control WHERE id=1",
        )!,
        suppressed = one(
          this.db,
          "SELECT 1 FROM feedback_suppression WHERE outcome=?",
          p.outcome,
        );
      const permitted =
        this.simulate &&
        !control.omit_all &&
        p.natural_pause &&
        !p.other_question_pending &&
        !suppressed &&
        (control.last_claim === null ||
          current - control.last_claim >= this.settings.cooldown_seconds);
      if (!permitted)
        return [
          { ok: true, saved: false, state: "omit" },
          p.outcome,
          null,
          null,
        ];
      run(
        this.db,
        "INSERT INTO feedback_prompts VALUES(?,?,?,?,?,?,'claimed',NULL,NULL)",
        p.request,
        p.outcome,
        p.thread,
        p.checkpoint,
        session,
        current,
      );
      run(this.db, "INSERT INTO feedback_suppression VALUES(?)", p.outcome);
      run(
        this.db,
        "UPDATE feedback_control SET last_claim=? WHERE id=1",
        current,
      );
      return [
        {
          ok: true,
          saved: true,
          state: "claimed",
          request: p.request,
          display_permitted: true,
        },
        p.outcome,
        p.request,
        null,
      ];
    }
    if (["shown", "skip", "silence"].includes(kind)) {
      exact(p, ["request", "outcome"]);
      const prompt = this.prompt(p, session, current);
      ensure(
        prompt.session === session,
        "binding",
        "Original session required",
      );
      let state: string;
      if (kind === "shown") {
        ensure(
          prompt.state === "claimed" &&
            current - prompt.claimed < this.settings.unconfirmed_seconds,
          "transition",
          "Claim expired",
        );
        run(
          this.db,
          "UPDATE feedback_prompts SET state='shown',shown=? WHERE id=?",
          current,
          p.request,
        );
        state = "shown";
      } else {
        ensure(
          prompt.state === "shown",
          "transition",
          "Only shown prompts may finish",
        );
        state = kind === "skip" ? "skipped" : "unanswered";
        run(
          this.db,
          "UPDATE feedback_prompts SET state=?,terminal=? WHERE id=?",
          state,
          current,
          p.request,
        );
      }
      return [{ ok: true, saved: true, state }, p.outcome, p.request, null];
    }
    if (["answer", "spontaneous"].includes(kind)) {
      const common = [
        "outcome",
        "rating",
        "quote",
        "context",
        "interpretation",
        "capability",
        "evidence",
      ];
      exact(
        p,
        kind === "answer"
          ? [...common, "request"]
          : [...common, "thread", "checkpoint"],
      );
      this.content(p);
      let thread: string, checkpoint: string, request: string | null;
      if (kind === "answer") {
        const prompt = this.prompt(p, session, current);
        ensure(
          ["shown", "unanswered", "unknown"].includes(prompt.state),
          "transition",
          "Request not answerable",
        );
        ensure(
          ["Yes", "Mixed", "No"].includes(p.rating),
          "invalid",
          "Prompted rating required",
        );
        thread = prompt.thread;
        checkpoint = prompt.checkpoint;
        request = prompt.id;
        run(
          this.db,
          "UPDATE feedback_prompts SET state='answered',terminal=? WHERE id=?",
          current,
          request,
        );
      } else {
        this.context(p.outcome, p.thread, p.checkpoint, session);
        ensure(
          !one(this.db, "SELECT omit_all FROM feedback_control WHERE id=1")!
            .omit_all,
          "suppressed",
          "Identity purge blocks capture",
        );
        validText(p.quote);
        thread = p.thread;
        checkpoint = p.checkpoint;
        request = null;
        run(
          this.db,
          "UPDATE feedback_prompts SET state='unknown',terminal=? WHERE outcome=? AND state='claimed'",
          current,
          p.outcome,
        );
      }
      run(
        this.db,
        "INSERT OR IGNORE INTO feedback_suppression VALUES(?)",
        p.outcome,
      );
      const body = Object.fromEntries(common.map((k) => [k, p[k]]));
      Object.assign(body, {
        source: kind,
        checkpoint,
        session,
        thread,
        received: current,
        interpretation_label: "agent interpretation",
      });
      run(
        this.db,
        "INSERT INTO feedback_content VALUES(?,?,?,?,?,?,?)",
        id,
        p.outcome,
        request,
        thread,
        session,
        current,
        canonical(body),
      );
      return [
        {
          ok: true,
          saved: true,
          state: request ? "answered" : "spontaneous",
          feedback: id,
        },
        p.outcome,
        request,
        id,
      ];
    }
    throw new FeedbackError("invalid", "Unsupported feedback operation");
  }
  prompt(p: Doc, session: string, current: number): Doc {
    validUuid(p.request);
    validUuid(p.outcome);
    const prompt = one(
      this.db,
      "SELECT * FROM feedback_prompts WHERE id=?",
      p.request,
    );
    ensure(
      prompt && prompt.outcome === p.outcome,
      "binding",
      "Original request/outcome missing",
    );
    ensure(
      current - prompt.claimed < this.settings.feedback_seconds,
      "expired",
      "Relationship expired",
    );
    this.context(prompt.outcome, prompt.thread, prompt.checkpoint, session);
    return prompt;
  }
  content(p: Doc): void {
    ensure(
      p.rating === null || ["Yes", "Mixed", "No"].includes(p.rating),
      "invalid",
      "No inferred ratings",
    );
    ensure(
      p.quote === null ||
        (typeof p.quote === "string" &&
          [...p.quote].length <= this.settings.quote_chars),
      "invalid",
      "Quote too long",
    );
    ensure(
      typeof p.context === "string" &&
        Buffer.byteLength(p.context) <= this.settings.context_bytes,
      "invalid",
      "Context too long",
    );
    ensure(
      p.interpretation === null ||
        (typeof p.interpretation === "string" &&
          Buffer.byteLength(p.interpretation) <= this.settings.context_bytes),
      "invalid",
      "Bad interpretation",
    );
    ensure(
      p.capability === null ||
        (typeof p.capability === "string" && p.capability.length <= 128),
      "invalid",
      "Bad capability",
    );
    ensure(
      Array.isArray(p.evidence) && p.evidence.length <= 10,
      "invalid",
      "Evidence too large",
    );
    for (const link of p.evidence) {
      exact(link, ["type", "ref"]);
      validText(link.type);
      validText(link.ref);
    }
    ensure(
      !/(-----BEGIN .*PRIVATE KEY|\b(?:password|token|api[_-]?key|secret)\s*[:=]|\b(?:sk-|ghp_)[A-Za-z0-9]{12,}|Bearer\s+\S+)/i.test(
        canonical(p),
      ),
      "sensitive_content",
      "Secret-like feedback rejected",
    );
  }
  maintain(): Doc {
    this.db.exec("BEGIN IMMEDIATE");
    let current: number, expired: string[];
    try {
      current = this.time();
      run(
        this.db,
        "UPDATE feedback_prompts SET state='unknown',terminal=? WHERE state='claimed' AND claimed<=?",
        current,
        current - this.settings.unconfirmed_seconds,
      );
      expired = all(
        this.db,
        "SELECT id FROM feedback_content WHERE received<=?",
        current - this.settings.feedback_seconds,
      ).map((r) => r.id);
      this.erase(expired);
      run(
        this.db,
        "DELETE FROM feedback_prompts WHERE claimed<=?",
        current - this.settings.feedback_seconds,
      );
      run(
        this.db,
        "DELETE FROM feedback_diagnostics WHERE received<=?",
        current - this.settings.diagnostic_seconds,
      );
      run(
        this.db,
        "UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE received<=?",
        canonical({ ok: true, saved: false, state: "suppressed" }),
        current - this.settings.diagnostic_seconds,
      );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return {
      expired_content: expired.length,
      removed_backups: this.purgeBackups(current, false),
    };
  }
  erase(ids: string[]): void {
    for (const id of ids) {
      validUuid(id);
      run(this.db, "INSERT OR IGNORE INTO feedback_deleted VALUES(?)", id);
      const record = one(
        this.db,
        "SELECT outcome,request FROM feedback_content WHERE id=?",
        id,
      );
      if (record) {
        run(
          this.db,
          "INSERT OR IGNORE INTO feedback_suppression VALUES(?)",
          record.outcome,
        );
        if (record.request !== null)
          run(
            this.db,
            "DELETE FROM feedback_prompts WHERE id=?",
            record.request,
          );
        run(
          this.db,
          "UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE content=? OR request=?",
          canonical({ ok: true, saved: false, state: "suppressed" }),
          id,
          record.request,
        );
      }
      run(this.db, "DELETE FROM feedback_content WHERE id=?", id);
      run(this.db, "DELETE FROM feedback_diagnostics WHERE id=?", id);
    }
  }
  delete(
    ids: string[],
    actor: string,
    options: {
      purgeBackups?: boolean;
      fullIdentityPurge?: boolean;
      outboxes?: FixtureOutbox[];
    } = {},
  ): Doc {
    ensure(actor === "owner", "forbidden", "Owner-authorised deletion only");
    this.db.exec("BEGIN IMMEDIATE");
    let current: number;
    try {
      current = this.time();
      if (options.fullIdentityPurge) {
        ids = all(this.db, "SELECT id FROM feedback_content").map((r) => r.id);
        run(this.db, "UPDATE feedback_control SET omit_all=1 WHERE id=1");
      }
      this.erase(ids);
      if (options.fullIdentityPurge)
        for (const table of [
          "feedback_prompts",
          "feedback_suppression",
          "feedback_diagnostics",
          "feedback_receipts",
          "feedback_deleted",
        ])
          run(this.db, `DELETE FROM ${table}`);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    const purged = this.purgeBackups(current, !!options.purgeBackups);
    for (const outbox of options.outboxes ?? []) {
      if (options.fullIdentityPurge) outbox.rows.clear();
      else outbox.delete(ids);
    }
    return {
      deleted: ids.length,
      purged_backups: purged,
      residual_backup_seconds: options.purgeBackups
        ? 0
        : this.settings.backup_seconds,
      physical_erasure: "not claimed",
    };
  }
  purgeBackups(current: number, allBackups: boolean): string[] {
    const removed: string[] = [];
    for (const r of all(this.db, "SELECT * FROM feedback_backups"))
      if (allBackups || current - r.created >= this.settings.backup_seconds) {
        ensure(
          !existsSync(r.path) || !lstatSync(r.path).isSymbolicLink(),
          "unsafe_path",
          "Changed backup symlink",
        );
        if (existsSync(r.path)) unlinkSync(r.path);
        run(this.db, "DELETE FROM feedback_backups WHERE path=?", r.path);
        removed.push(r.path);
      }
    return removed;
  }
  async backup(target: string): Promise<void> {
    await this.store.backup(target, this.clock());
  }
  async restore(source: string, target: string): Promise<void> {
    const { Store, privatePath } = await import("./continuity.ts");
    const original = new Store(privatePath(source), true, true);
    const current = this.clock();
    try {
      const lineage = "SELECT value FROM store_meta WHERE key='store_id'";
      ensure(
        one(original.db, lineage)?.value === one(this.db, lineage)?.value,
        "lineage",
        "Current deletion ledger missing or belongs elsewhere",
      );
      const meta = one(
        original.db,
        "SELECT value FROM store_meta WHERE key='snapshot_time'",
      );
      ensure(
        meta &&
          current - Number(meta.value) >= 0 &&
          current - Number(meta.value) < this.settings.backup_seconds,
        "expired",
        "Backup outside retention",
      );
      await original.backup(target, current, false);
    } finally {
      original.close();
    }
    const restored = new Store(target, false, true);
    try {
      restored.db.exec("BEGIN IMMEDIATE");
      const control = one(
        this.db,
        "SELECT * FROM feedback_control WHERE id=1",
      )!;
      ensure(
        control.last_clock === null || current >= control.last_clock,
        "clock",
        "Clock rollback blocks restore",
      );
      run(
        restored.db,
        "UPDATE feedback_control SET last_claim=?,last_clock=?,omit_all=? WHERE id=1",
        control.last_claim,
        Math.max(current, control.last_clock ?? current),
        control.omit_all,
      );
      const service = new Feedback(restored, this.clock, this.simulate);
      service.erase(
        all(this.db, "SELECT id FROM feedback_deleted").map((r) => r.id),
      );
      for (const r of all(this.db, "SELECT * FROM feedback_suppression"))
        run(
          restored.db,
          "INSERT OR IGNORE INTO feedback_suppression VALUES(?)",
          r.outcome,
        );
      for (const r of all(this.db, "SELECT * FROM feedback_receipts")) {
        if (r.payload_hash === null)
          run(
            restored.db,
            "UPDATE feedback_receipts SET payload_hash=NULL,result=? WHERE id=?",
            r.result,
            r.id,
          );
        run(
          restored.db,
          "INSERT OR IGNORE INTO feedback_receipts VALUES(?,?,?,?,?,?,?,?,?)",
          r.id,
          r.producer,
          r.sequence,
          r.outcome,
          r.request,
          r.content,
          null,
          canonical({ ok: true, saved: false, state: "suppressed" }),
          r.received,
        );
      }
      run(
        restored.db,
        "UPDATE feedback_prompts SET state='unknown',terminal=? WHERE state='claimed'",
        current,
      );
      for (const r of all(
        this.db,
        "SELECT id,state,terminal FROM feedback_prompts WHERE state='skipped'",
      ))
        run(
          restored.db,
          "UPDATE feedback_prompts SET state=?,terminal=? WHERE id=?",
          r.state,
          r.terminal,
          r.id,
        );
      if (control.omit_all)
        for (const table of [
          "feedback_content",
          "feedback_prompts",
          "feedback_receipts",
          "feedback_suppression",
          "feedback_deleted",
          "feedback_diagnostics",
        ])
          run(restored.db, `DELETE FROM ${table}`);
      restored.db.exec("COMMIT");
      service.maintain();
      run(restored.db, "DELETE FROM store_meta WHERE key='snapshot_time'");
    } catch (e) {
      if (restored.db.isTransaction) restored.db.exec("ROLLBACK");
      throw e;
    } finally {
      restored.close();
    }
  }
  review(
    reviewer: string,
    start: number,
    end: number,
    authorization?: Doc,
    limit = 100,
  ): Doc {
    ensure(
      ["owner", "collector", "concierge"].includes(reviewer),
      "forbidden",
      "Raw feedback unavailable",
    );
    ensure(
      Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= start &&
        end - start <= 90 * 86400,
      "invalid",
      "Bounded review window required",
    );
    integer(limit, 1);
    ensure(limit <= 200, "invalid", "Bounded result limit");
    if (reviewer === "concierge") {
      exact(authorization, ["approved_by", "start", "end", "purpose"]);
      ensure(
        authorization!.approved_by === "owner" &&
          start >= authorization!.start &&
          end <= authorization!.end,
        "forbidden",
        "Explicit bounded owner authorisation required",
      );
      validText(authorization!.purpose);
    }
    const cutoff = Math.max(
        start,
        this.clock() - this.settings.feedback_seconds,
      ),
      content = all(
        this.db,
        "SELECT body FROM feedback_content WHERE received>=? AND received<=? ORDER BY received,id LIMIT ?",
        cutoff,
        end,
        limit + 1,
      ),
      prompts = all(
        this.db,
        "SELECT state,count(*) AS n FROM feedback_prompts WHERE claimed>=? AND claimed<=? GROUP BY state",
        cutoff,
        end,
      ),
      events = all(
        this.db,
        "SELECT kind,subject,body,result FROM events WHERE CAST(strftime('%s',event_time) AS REAL)>=? AND CAST(strftime('%s',event_time) AS REAL)<=? ORDER BY receipt_time,id LIMIT 1001",
        start,
        end,
      ),
      sessions = new Set<string>(),
      usage = {
        new_threads: 0,
        accepted_handoffs: 0,
        resumed_threads: "unknown; no live adapter",
      };
    for (const ev of events.slice(0, 1000)) {
      if (!JSON.parse(ev.result).ok) continue;
      const envelope = JSON.parse(ev.body);
      if (envelope.actor.session) sessions.add(envelope.actor.session);
      if (ev.kind === "register") sessions.add(ev.subject);
      if (ev.kind === "open") usage.new_threads++;
      if (ev.kind === "accept") usage.accepted_handoffs++;
    }
    const providers = [
      ...new Set(
        [...sessions]
          .map((id) => this.record("sessions", id).identity?.provider)
          .filter(Boolean),
      ),
    ].sort();
    return {
      feedback: content.slice(0, limit).map((r) => JSON.parse(r.body)),
      truncated: content.length > limit,
      prompt_states: Object.fromEntries(prompts.map((r) => [r.state, r.n])),
      window: [start, end],
      coverage: {
        registered_providers: providers,
        live_adapters: [],
        observed_usage: usage,
        participating_sessions: [...sessions].sort(),
        event_coverage_truncated: events.length > 1000,
        limits:
          "Offline fixtures only; unregistered use/non-use unknown. No overall adoption rate or time saved inferred.",
      },
      improvement:
        "Concierge may propose one evidence-linked change and success signal; owner decides",
    };
  }
}
export class FixtureOutbox {
  readonly rows = new Map<string, Doc>();
  readonly boundSession: string;
  readonly producer: string;
  constructor(boundSession: string, producer: string) {
    this.boundSession = boundSession;
    this.producer = producer;
  }
  enqueue(event: Doc, at: number): void {
    const copy = JSON.parse(canonical(event)),
      old = this.rows.get(copy.id);
    ensure(
      !old || canonical(old.event) === canonical(copy),
      "replay_conflict",
      "Outbox event changed",
    );
    if (!old)
      this.rows.set(copy.id, { event: copy, created: at, acknowledged: null });
  }
  collect(service: Feedback, id: string): Doc {
    const row = this.rows.get(id);
    ensure(row, "invalid", "Missing outbox event");
    const result = service.submit(row.event, this.boundSession, this.producer);
    if (result.ok) row.acknowledged = service.clock();
    return result;
  }
  maintain(service: Feedback): Doc[] {
    const lost: Doc[] = [];
    for (const [id, r] of this.rows) {
      const expire =
        r.acknowledged !== null
          ? service.clock() - r.acknowledged >=
            service.settings.acknowledged_outbox_seconds
          : service.clock() - r.created >=
            service.settings.pending_outbox_seconds;
      if (expire) {
        if (r.acknowledged === null)
          lost.push({ id, state: "lost-capture", saved: false });
        this.rows.delete(id);
      }
    }
    return lost;
  }
  delete(ids: string[]): void {
    ids.forEach((id) => this.rows.delete(id));
  }
}

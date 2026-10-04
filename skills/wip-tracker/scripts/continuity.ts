/** Offline C1/C2 continuity records. No launcher, role integration, or live store. */
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { feedbackSchema } from "./continuity_feedback.ts";

export const VERSION = 2,
  MAX_BYTES = 65536;
export interface TypedLink {
  type: string;
  ref: string;
}
export interface OutcomeCondition {
  id: string;
  text: string;
}
export interface SemanticAction {
  id: string;
  text: string;
  category:
    "required-now" | "waiting" | "optional-follow-up" | "separate-opportunity";
  actor: {
    status: "confirmed" | "proposed" | "unknown";
    name: string | null;
    evidence: TypedLink[];
  };
  destination:
    | { status: "verified"; session: string }
    | { status: "unknown"; session: null };
  dependencies: string[];
  evidence: TypedLink[];
  contribution: string;
}
export interface SemanticCheckpoint {
  position: string;
  decisions: string[];
  evidence: TypedLink[];
  questions: string[];
  blockers: string[];
  next_action?: string;
  actions?: SemanticAction[];
  closeout?: {
    primary_action_id: string;
    candidates: Array<{ action_id: string; benefit: string; estimate: string }>;
  };
  observations?: Array<{
    key: string;
    claim: string;
    observed_at: string;
    source: TypedLink;
    status: "supported" | "unknown" | "contradicted";
    blocks?: boolean;
    hold_reason?: string;
    release_condition?: string;
  }>;
  conditions?: Array<{
    id: string;
    state: "met" | "gap" | "unknown";
    evidence: string[];
    remaining: string;
  }>;
  scope_revision?: number;
  engagement_exit?: {
    revision: number;
    assessment: "met" | "unmet" | "unknown";
    evidence: TypedLink[];
    remaining: string;
    next_action: string;
  };
}
export interface HandoffBrief {
  ref: string;
  outcome: string;
  sources: TypedLink[];
  decisions: string[];
  scope: string;
  exclusions: string;
  next_action: string;
  destination: string;
  mode: "collaboration" | "facilitation" | "service";
  exit_condition: string;
}
export interface CheckpointPayload {
  thread: string;
  expected_revision: number;
  assignment_revision: number;
  content: SemanticCheckpoint;
  disposition?: "open" | "parked" | "closed";
  human_approval?: string;
}
export interface PreparePayload {
  thread: string;
  expected_thread_revision: number;
  receiver: string;
  brief: HandoffBrief;
  authority: string;
  expected_handoff_revision: number;
}
export interface AcceptPayload {
  revision: number;
  expected_state_revision: number;
  expected_thread_revision: number;
  previous_coordinator: string;
  checkpoint_id: string;
  content: SemanticCheckpoint;
  understanding: string;
}
export type TypedContinuityEvent = Omit<Event, "kind" | "payload"> &
  (
    | { kind: "checkpoint"; payload: CheckpointPayload }
    | { kind: "prepare"; payload: PreparePayload }
    | { kind: "accept"; payload: AcceptPayload }
  );
export type Doc = Record<string, any>;
export type Actor = {
  producer: string;
  kind: "operator" | "launcher" | "observer" | "session";
  session: string | null;
};
export type Event = {
  id: string;
  sequence: number;
  kind: string;
  subject: string;
  time: string;
  payload: Doc;
};
export class ContinuityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function check(
  value: unknown,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new ContinuityError(code, message);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  check(
    value !== undefined &&
      (typeof value !== "number" || Number.isFinite(value)),
    "invalid",
    "Non-JSON value",
  );
  return JSON.stringify(value);
}
export const digest = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const now = (): string => new Date().toISOString();
export function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Doc {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid",
    "Expected object",
  );
  const keys = Object.keys(value as object);
  check(
    required.every((k) => keys.includes(k)) &&
      keys.every((k) => required.includes(k) || optional.includes(k)),
    "invalid",
    "Missing or unrecognised fields",
  );
}
export function text(value: unknown): asserts value is string {
  check(
    typeof value === "string" && !!value.trim(),
    "invalid",
    "Expected nonempty text",
  );
}
export function uuid(value: unknown): asserts value is string {
  check(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value,
      ),
    "invalid",
    "Expected canonical UUID",
  );
}
export function integer(value: unknown, min = 0): asserts value is number {
  check(
    Number.isSafeInteger(value) && (value as number) >= min,
    "invalid",
    "Expected nonnegative integer",
  );
}
export function instant(value: unknown): number {
  text(value);
  check(/(?:Z|[+-]\d\d:\d\d)$/.test(value), "invalid", "Timezone required");
  const n = Date.parse(value);
  check(Number.isFinite(n), "invalid", "Bad ISO timestamp");
  return n;
}
export function strings(value: unknown): asserts value is string[] {
  check(Array.isArray(value), "invalid", "Expected string array");
  value.forEach(text);
}
export function links(value: unknown): void {
  check(Array.isArray(value), "invalid", "Expected typed links");
  for (const x of value) {
    fields(x, ["type", "ref"]);
    text(x.type);
    text(x.ref);
  }
}
export function interaction(mode: unknown, exit: unknown): void {
  check(
    ["collaboration", "facilitation", "service"].includes(mode as string),
    "invalid",
    "Bad interaction mode",
  );
  text(exit);
}
export function semantic(value: unknown): asserts value is SemanticCheckpoint {
  fields(
    value,
    ["position", "decisions", "evidence", "questions", "blockers"],
    [
      "next_action",
      "actions",
      "closeout",
      "observations",
      "conditions",
      "scope_revision",
      "engagement_exit",
    ],
  );
  text(value.position);
  check(
    "actions" in value || "next_action" in value,
    "invalid",
    "Actions or next_action required",
  );
  if ("next_action" in value) text(value.next_action);
  if ("actions" in value) {
    check(Array.isArray(value.actions), "invalid", "Expected actions");
    for (const a of value.actions) {
      fields(a, [
        "id",
        "text",
        "category",
        "actor",
        "destination",
        "dependencies",
        "evidence",
        "contribution",
      ]);
      text(a.id);
      text(a.text);
      text(a.contribution);
      check(
        [
          "required-now",
          "waiting",
          "optional-follow-up",
          "separate-opportunity",
        ].includes(a.category),
        "invalid",
        "Bad action category",
      );
      fields(a.actor, ["status", "name", "evidence"]);
      check(
        ["confirmed", "proposed", "unknown"].includes(a.actor.status),
        "invalid",
        "Bad actor",
      );
      if (a.actor.status === "unknown")
        check(
          a.actor.name === null,
          "invalid",
          "Unknown actor cannot be named",
        );
      else text(a.actor.name);
      links(a.actor.evidence);
      check(
        a.actor.status !== "confirmed" || a.actor.evidence.length,
        "invalid",
        "Confirmed actor needs evidence",
      );
      fields(a.destination, ["status", "session"]);
      check(
        ["verified", "unknown"].includes(a.destination.status),
        "invalid",
        "Bad destination",
      );
      if (a.destination.status === "verified") uuid(a.destination.session);
      else
        check(
          a.destination.session === null,
          "invalid",
          "Unknown destination must be null",
        );
      strings(a.dependencies);
      links(a.evidence);
    }
    check(
      new Set(value.actions.map((a: Doc) => a.id)).size ===
        value.actions.length,
      "invalid",
      "Duplicate action IDs",
    );
  }
  if ("closeout" in value) {
    fields(value.closeout, ["primary_action_id", "candidates"]);
    const { primary_action_id, candidates } = value.closeout;
    text(primary_action_id);
    check(Array.isArray(candidates), "invalid", "Expected closeout candidates");
    const actions = value.actions ?? [];
    check(actions.length > 0, "invalid", "Closeout needs classified actions");
    for (const candidate of candidates) {
      fields(candidate, ["action_id", "benefit", "estimate"]);
      text(candidate.action_id);
      text(candidate.benefit);
      text(candidate.estimate);
    }
    check(
      candidates.length === actions.length &&
        new Set(candidates.map((c) => c.action_id)).size === actions.length &&
        actions.every((a: SemanticAction) =>
          candidates.some((c) => c.action_id === a.id),
        ) &&
        actions.some((a: SemanticAction) => a.id === primary_action_id),
      "invalid",
      "Closeout must classify each action and name one primary",
    );
    check(
      !actions.some((a: SemanticAction) =>
        ["required-now", "waiting"].includes(a.category),
      ) ||
        actions.some(
          (a: SemanticAction) =>
            a.id === primary_action_id &&
            ["required-now", "waiting"].includes(a.category),
        ),
      "invalid",
      "Primary must advance required work while it remains",
    );
  }
  for (const k of ["decisions", "questions", "blockers"]) strings(value[k]);
  links(value.evidence);
  check(
    Array.isArray(value.observations ?? []),
    "invalid",
    "Expected observations",
  );
  for (const o of value.observations ?? []) {
    fields(
      o,
      ["key", "claim", "observed_at", "source", "status"],
      ["blocks", "hold_reason", "release_condition"],
    );
    text(o.key);
    text(o.claim);
    instant(o.observed_at);
    links([o.source]);
    check(
      ["supported", "unknown", "contradicted"].includes(o.status),
      "invalid",
      "Bad evidence status",
    );
    if ("blocks" in o)
      check(
        typeof o.blocks === "boolean",
        "invalid",
        "Expected dependency boolean",
      );
    if ("hold_reason" in o || "release_condition" in o) {
      text(o.hold_reason);
      text(o.release_condition);
    }
  }
  check(
    Array.isArray(value.conditions ?? []),
    "invalid",
    "Expected conditions",
  );
  if (value.conditions?.length) integer(value.scope_revision, 1);
  for (const c of value.conditions ?? []) {
    fields(c, ["id", "state", "evidence", "remaining"]);
    text(c.id);
    check(
      ["met", "gap", "unknown"].includes(c.state),
      "invalid",
      "Bad condition state",
    );
    strings(c.evidence);
    check(
      c.state !== "met" || c.evidence.length,
      "invalid",
      "Met condition needs evidence",
    );
    check(typeof c.remaining === "string", "invalid", "Bad remaining");
  }
  if (value.engagement_exit) {
    const e = value.engagement_exit;
    fields(e, [
      "revision",
      "assessment",
      "evidence",
      "remaining",
      "next_action",
    ]);
    integer(e.revision, 1);
    check(
      ["met", "unmet", "unknown"].includes(e.assessment),
      "invalid",
      "Bad exit assessment",
    );
    links(e.evidence);
    check(
      e.assessment === "unknown" || e.evidence.length,
      "invalid",
      "Exit assessment needs evidence",
    );
    check(typeof e.remaining === "string", "invalid", "Bad remaining");
    if (e.assessment !== "met") {
      text(e.remaining);
      text(e.next_action);
    } else
      check(typeof e.next_action === "string", "invalid", "Bad next action");
  }
}
export const schema = `
CREATE TABLE sessions(id TEXT PRIMARY KEY,environment TEXT NOT NULL,launch_attempt TEXT NOT NULL,provider TEXT,provider_id TEXT,body TEXT NOT NULL,UNIQUE(environment,launch_attempt),UNIQUE(environment,provider,provider_id));
CREATE TABLE threads(id TEXT PRIMARY KEY,coordinator TEXT NOT NULL REFERENCES sessions(id),checkpoint TEXT REFERENCES checkpoints(id),outcome TEXT REFERENCES outcomes(id),origin TEXT REFERENCES threads(id),body TEXT NOT NULL);
CREATE TABLE outcomes(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL);
CREATE TABLE outcome_scopes(id TEXT NOT NULL REFERENCES outcomes(id),revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,revision));
CREATE TABLE checkpoints(id TEXT PRIMARY KEY,thread TEXT NOT NULL REFERENCES threads(id),author TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL);
CREATE TABLE handoffs(id TEXT NOT NULL,revision INTEGER NOT NULL,thread TEXT NOT NULL REFERENCES threads(id),sender TEXT NOT NULL REFERENCES sessions(id),receiver TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL,PRIMARY KEY(id,revision));
CREATE TABLE engagements(id TEXT PRIMARY KEY,thread TEXT NOT NULL REFERENCES threads(id),revision INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(thread,revision));
CREATE TABLE launch_requests(id TEXT PRIMARY KEY,thread TEXT NOT NULL REFERENCES threads(id),body TEXT NOT NULL);
CREATE TABLE events(id TEXT PRIMARY KEY,producer TEXT NOT NULL,sequence INTEGER NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,event_time TEXT NOT NULL,receipt_time TEXT NOT NULL,payload_hash TEXT NOT NULL,body TEXT NOT NULL,result TEXT NOT NULL,UNIQUE(producer,sequence));
CREATE INDEX handoffs_thread ON handoffs(thread); CREATE INDEX checkpoints_thread ON checkpoints(thread); CREATE INDEX engagements_thread ON engagements(thread);
PRAGMA user_version=2;
${feedbackSchema}`;
export const one = (
  db: DatabaseSync,
  sql: string,
  ...args: any[]
): Doc | undefined => db.prepare(sql).get(...args) as Doc | undefined;
export const all = (db: DatabaseSync, sql: string, ...args: any[]): Doc[] =>
  db.prepare(sql).all(...args) as Doc[];
export const run = (db: DatabaseSync, sql: string, ...args: any[]): void => {
  db.prepare(sql).run(...args);
};
export function privatePath(path: string, create = false): string {
  check(isAbsolute(path), "unsafe_path", "Absolute store path required");
  const target = resolve(path);
  for (let part = target; ; part = dirname(part)) {
    if (existsSync(part))
      check(
        !lstatSync(part).isSymbolicLink(),
        "unsafe_path",
        "Symlink store paths unsupported",
      );
    if (part === dirname(part)) break;
  }
  const parent = dirname(target);
  if (create && !existsSync(parent)) mkdirSync(parent, { mode: 0o700 });
  check(existsSync(parent), "missing_store", "Store directory missing");
  const dir = statSync(parent);
  check(
    dir.isDirectory() &&
      dir.uid === process.getuid!() &&
      (dir.mode & 0o777) === 0o700,
    "unsafe_path",
    "Store directory must be owner-held 0700",
  );
  if (existsSync(target)) {
    const f = statSync(target);
    check(
      f.isFile() && f.uid === process.getuid!() && (f.mode & 0o777) === 0o600,
      "unsafe_path",
      "Store must be owner-held 0600 file",
    );
  }
  return target;
}
export class Store {
  readonly db: DatabaseSync;
  readonly path: string;
  static initialize(path: string): void {
    const target = privatePath(path, true);
    let fd: number;
    try {
      fd = openSync(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
    } catch (e: any) {
      if (e.code === "EEXIST")
        throw new ContinuityError("exists", "Store already exists");
      throw e;
    }
    closeSync(fd);
    const db = new DatabaseSync(target);
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(schema);
      run(db, "INSERT INTO store_meta VALUES('store_id',?)", randomUUID());
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  }
  constructor(path: string, readonly = false, allowSnapshot = false) {
    this.path = privatePath(path);
    check(
      existsSync(this.path),
      "missing_store",
      "Explicit initialization required",
    );
    this.db = new DatabaseSync(this.path, {
      readOnly: readonly,
      timeout: 3000,
    });
    try {
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON;",
      );
      check(
        one(this.db, "PRAGMA user_version")?.user_version === VERSION,
        "schema",
        "Unsupported schema version",
      );
      const expected = new DatabaseSync(":memory:");
      try {
        expected.exec(schema);
        const q =
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name";
        check(
          canonical(all(this.db, q)) === canonical(all(expected, q)),
          "schema",
          "Schema differs from version 2",
        );
      } finally {
        expected.close();
      }
      check(
        one(this.db, "PRAGMA quick_check")?.quick_check === "ok" &&
          !all(this.db, "PRAGMA foreign_key_check").length,
        "schema",
        "Corrupt store",
      );
      check(
        allowSnapshot ||
          !one(this.db, "SELECT 1 FROM store_meta WHERE key='snapshot_time'"),
        "snapshot",
        "Sealed backup requires restore",
      );
      uuid(
        one(this.db, "SELECT value FROM store_meta WHERE key='store_id'")
          ?.value,
      );
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  close(): void {
    this.db.close();
  }
  get(table: string, id: string, revision?: number): Doc {
    check(
      [
        "sessions",
        "threads",
        "handoffs",
        "checkpoints",
        "launch_requests",
        "outcomes",
      ].includes(table),
      "invalid",
      "Unknown record family",
    );
    const q =
      `SELECT body FROM ${table} WHERE id=?` +
      (table === "handoffs"
        ? `${revision === undefined ? "" : " AND revision=?"} ORDER BY revision DESC LIMIT 1`
        : "");
    const v = one(
      this.db,
      q,
      ...[
        id,
        ...(table === "handoffs" && revision !== undefined ? [revision] : []),
      ],
    );
    check(v, "not_found", `Missing ${table} record`);
    return JSON.parse(v.body);
  }
  engagement(thread: string, revision?: number): Doc | null {
    if (revision !== undefined) integer(revision, 1);
    const v = one(
      this.db,
      `SELECT body FROM engagements WHERE thread=?${revision === undefined ? "" : " AND revision=?"} ORDER BY revision DESC LIMIT 1`,
      thread,
      ...(revision === undefined ? [] : [revision]),
    );
    return v ? JSON.parse(v.body) : null;
  }
  put(table: string, body: Doc, columns: Doc = {}): void {
    const v = { id: body.id, ...columns, body: canonical(body) };
    run(
      this.db,
      `INSERT INTO ${table} (${Object.keys(v).join(",")}) VALUES (${Object.keys(
        v,
      )
        .map(() => "?")
        .join(",")})`,
      ...Object.values(v),
    );
  }
  update(table: string, body: Doc, columns: Doc = {}): void {
    const v = { ...columns, body: canonical(body) };
    run(
      this.db,
      `UPDATE ${table} SET ${Object.keys(v)
        .map((k) => `${k}=?`)
        .join(",")} WHERE id=?${table === "handoffs" ? " AND revision=?" : ""}`,
      ...Object.values(v),
      body.id,
      ...(table === "handoffs" ? [body.revision] : []),
    );
  }
  apply(event: Event, actor: Actor, authorize?: (event: Event) => void): Doc {
    fields(actor, ["producer", "kind", "session"]);
    text(actor.producer);
    check(
      ["operator", "launcher", "observer", "session"].includes(actor.kind),
      "invalid",
      "Bad producer kind",
    );
    if (actor.session !== null) uuid(actor.session);
    check(
      actor.kind !== "session" || actor.session,
      "invalid",
      "Session channel must be bound",
    );
    fields(event, ["id", "sequence", "kind", "subject", "time", "payload"]);
    uuid(event.id);
    uuid(event.subject);
    integer(event.sequence);
    text(event.kind);
    instant(event.time);
    check(
      Buffer.byteLength(canonical(event)) <= MAX_BYTES,
      "invalid",
      "Event exceeds 64 KiB",
    );
    const envelope = { event, actor },
      hash = digest(envelope);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = all(
        this.db,
        "SELECT * FROM events WHERE id=? OR (producer=? AND sequence=?)",
        event.id,
        actor.producer,
        event.sequence,
      );
      if (prior.length) {
        check(
          prior.length === 1 &&
            prior[0].id === event.id &&
            prior[0].payload_hash === hash,
          "replay_conflict",
          "Event identity collision",
        );
        this.db.exec("COMMIT");
        return JSON.parse(prior[0].result);
      }
      this.db.exec("SAVEPOINT mutation");
      let result: Doc;
      try {
        authorize?.(event);
        result = { ok: true, value: this.dispatch(event, actor) };
      } catch (e: any) {
        if (
          !(e instanceof ContinuityError) &&
          !(
            e.code === "ERR_SQLITE_ERROR" &&
            /constraint failed/i.test(e.message)
          )
        )
          throw e;
        this.db.exec("ROLLBACK TO mutation");
        result = {
          ok: false,
          error: {
            code: e instanceof ContinuityError ? e.code : "conflict",
            message: e.message,
          },
        };
      }
      this.db.exec("RELEASE mutation");
      run(
        this.db,
        "INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)",
        event.id,
        actor.producer,
        event.sequence,
        event.kind,
        event.subject,
        event.time,
        now(),
        hash,
        canonical(envelope),
        canonical(result),
      );
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw e;
    }
  }
  static revision(body: Doc, expected: unknown): void {
    integer(expected);
    check(body.revision === expected, "stale", "Record revision changed");
  }
  static owner(t: Doc, a: Actor): void {
    check(
      a.kind === "session" && a.session === t.coordinator,
      "forbidden",
      "Current coordinating session required",
    );
  }
  checkpoint(
    id: string,
    t: Doc,
    author: string,
    content: Doc,
    time: string,
  ): Doc {
    uuid(id);
    semantic(content);
    if (content.engagement_exit)
      check(
        t.engagement_revision === content.engagement_exit.revision,
        "stale",
        "Engagement exit targets another agreement",
      );
    for (const a of content.actions ?? [])
      if (a.destination.status === "verified")
        check(
          this.get("sessions", a.destination.session).identity,
          "invalid",
          "Destination identity unverified",
        );
    if (content.conditions?.length) {
      check(t.outcome_id, "invalid", "Conditions need outcome");
      const outcome = this.get("outcomes", t.outcome_id);
      check(
        content.scope_revision === outcome.scope_revision,
        "stale",
        "Scope changed",
      );
      check(
        content.conditions.every((c: Doc) =>
          outcome.conditions.some((x: Doc) => x.id === c.id),
        ),
        "invalid",
        "Unknown completion condition",
      );
    }
    check(
      (content.observations ?? []).every(
        (o: Doc) => instant(o.observed_at) <= instant(time),
      ),
      "invalid",
      "Observation postdates checkpoint",
    );
    const cp = {
      id,
      thread: t.id,
      author,
      assignment_revision: t.assignment_revision,
      content,
      time,
    };
    this.put("checkpoints", cp, { thread: t.id, author });
    t.checkpoint = id;
    return cp;
  }
  dispatch(e: Event, a: Actor, internalSelection = false): Doc {
    const { kind, payload: p, subject } = e;
    if (kind === "register") {
      check(
        ["operator", "launcher"].includes(a.kind),
        "forbidden",
        "Trusted registration required",
      );
      fields(p, [
        "role",
        "environment",
        "launch_attempt",
        "profile",
        "identity",
      ]);
      for (const k of ["role", "environment", "profile"]) text(p[k]);
      uuid(p.launch_attempt);
      if (p.identity !== null) {
        fields(p.identity, [
          "provider",
          "session_id",
          "resume_ref",
          "evidence",
        ]);
        Object.values(p.identity).forEach(text);
      }
      const body = { id: subject, ...p, revision: 0, observation: null };
      const prior = all(
        this.db,
        "SELECT body FROM sessions WHERE id=? OR (environment=? AND launch_attempt=?)",
        subject,
        p.environment,
        p.launch_attempt,
      );
      if (prior.length) {
        const old = JSON.parse(prior[0].body);
        check(
          prior.length === 1 &&
            old.id === subject &&
            Object.keys(p).every((k) => canonical(old[k]) === canonical(p[k])),
          "conflict",
          "Registration differs",
        );
        return old;
      }
      this.put("sessions", body, {
        environment: p.environment,
        launch_attempt: p.launch_attempt,
        provider: p.identity?.provider ?? null,
        provider_id: p.identity?.session_id ?? null,
      });
      return body;
    }
    if (kind === "open") {
      fields(
        p,
        ["title", "outcome", "links", "coordinator"],
        ["outcome_id", "origin", "origin_action"],
      );
      text(p.title);
      text(p.outcome);
      links(p.links);
      this.get("sessions", p.coordinator);
      if (p.outcome_id) this.get("outcomes", p.outcome_id);
      if (p.origin) this.get("threads", p.origin);
      if (p.origin_action) {
        check(
          internalSelection,
          "forbidden",
          "Action origin requires explicit candidate selection",
        );
        fields(p.origin_action, ["checkpoint", "action_id"]);
        check(p.origin, "invalid", "Action origin needs parent thread");
        const cp = this.get("checkpoints", p.origin_action.checkpoint);
        check(cp.thread === p.origin, "invalid", "Action origin differs");
        check(
          cp.content.actions?.some(
            (x: Doc) => x.id === p.origin_action.action_id,
          ),
          "invalid",
          "Action origin missing",
        );
      }
      check(
        a.kind === "operator" ||
          (a.kind === "session" && a.session === p.coordinator),
        "forbidden",
        "Cannot assign another session",
      );
      const body = {
        id: subject,
        ...p,
        revision: 0,
        assignment_revision: 0,
        engagement_revision: 0,
        disposition: "open",
        checkpoint: null,
      };
      this.put("threads", body, {
        coordinator: p.coordinator,
        outcome: p.outcome_id ?? null,
        origin: p.origin ?? null,
      });
      return body;
    }
    if (kind === "select-candidate") {
      fields(p, [
        "source_checkpoint",
        "action_id",
        "outcome_id",
        "title",
        "conditions",
        "authority",
        "reason",
        "coordinator",
      ]);
      check(a.kind === "session", "forbidden", "Working session required");
      const cp = this.get("checkpoints", p.source_checkpoint);
      const parent = this.get("threads", cp.thread);
      Store.owner(parent, a);
      check(parent.outcome_id, "invalid", "Source needs an outcome");
      const candidate = cp.content.actions?.find(
        (x: Doc) => x.id === p.action_id,
      );
      check(
        cp.content.closeout?.candidates.some(
          (x: Doc) => x.action_id === p.action_id,
        ) &&
          candidate &&
          ["optional-follow-up", "separate-opportunity"].includes(
            candidate.category,
          ),
        "invalid",
        "Only a recorded optional or separate candidate can branch",
      );
      check(
        !one(
          this.db,
          "SELECT e.id FROM events e JOIN checkpoints c ON c.id=json_extract(e.body,'$.event.payload.source_checkpoint') WHERE e.kind='select-candidate' AND c.thread=? AND json_extract(e.body,'$.event.payload.action_id')=? AND json_extract(e.result,'$.ok')=1",
          parent.id,
          p.action_id,
        ),
        "conflict",
        "Candidate already activated",
      );
      check(
        p.coordinator === a.session,
        "forbidden",
        "Open under current coordinator, then hand off explicitly",
      );
      links(p.authority);
      check(
        p.authority.some((x: TypedLink) => x.type === "human-approval"),
        "forbidden",
        "Explicit selection authority required",
      );
      this.dispatch(
        {
          ...e,
          kind: "outcome-scope",
          subject: p.outcome_id,
          payload: {
            expected_revision: 0,
            title: p.title,
            conditions: p.conditions,
            authority: p.authority,
            reason: p.reason,
          },
        },
        a,
      );
      return this.dispatch(
        {
          ...e,
          kind: "open",
          payload: {
            title: p.title,
            outcome: p.title,
            links: [{ type: "source-outcome", ref: parent.outcome_id }],
            coordinator: p.coordinator,
            outcome_id: p.outcome_id,
            origin: parent.id,
            origin_action: { checkpoint: cp.id, action_id: p.action_id },
          },
        },
        a,
        true,
      );
    }
    if (kind === "bind-provider") {
      check(
        a.kind === "launcher",
        "forbidden",
        "Trusted harness identity producer required",
      );
      fields(p, ["expected_revision", "identity"]);
      fields(p.identity, ["provider", "session_id", "resume_ref", "evidence"]);
      Object.values(p.identity).forEach(text);
      const body = this.get("sessions", subject);
      Store.revision(body, p.expected_revision);
      check(body.identity === null, "conflict", "Provider identity immutable");
      body.identity = p.identity;
      body.revision++;
      this.update("sessions", body, {
        provider: p.identity.provider,
        provider_id: p.identity.session_id,
      });
      return body;
    }
    if (kind === "outcome-scope" || kind === "complete-outcome")
      return this.outcomeEvent(e, a);
    if (kind === "observe") {
      fields(p, [
        "expected_revision",
        "state",
        "location",
        "observed_at",
        "source",
      ]);
      check(
        ["observer", "launcher"].includes(a.kind),
        "forbidden",
        "Observation producer required",
      );
      check(
        ["available", "exited", "unknown"].includes(p.state),
        "invalid",
        "Bad observation state",
      );
      check(
        p.location === null || typeof p.location === "string",
        "invalid",
        "Bad location",
      );
      text(p.source);
      instant(p.observed_at);
      const body = this.get("sessions", subject);
      Store.revision(body, p.expected_revision);
      if (body.observation)
        check(
          instant(p.observed_at) > instant(body.observation.observed_at),
          "stale",
          "Older observation",
        );
      body.observation = {
        state: p.state,
        location: p.location,
        observed_at: p.observed_at,
        source: p.source,
      };
      body.revision++;
      this.update("sessions", body);
      return body;
    }
    if (kind === "checkpoint") {
      fields(
        p,
        ["thread", "expected_revision", "assignment_revision", "content"],
        ["disposition", "human_approval"],
      );
      const t = this.get("threads", p.thread);
      Store.owner(t, a);
      Store.revision(t, p.expected_revision);
      integer(p.assignment_revision);
      check(
        t.assignment_revision === p.assignment_revision,
        "stale",
        "Assignment changed",
      );
      if ("disposition" in p) {
        check(
          ["open", "parked", "closed"].includes(p.disposition),
          "invalid",
          "Bad disposition",
        );
        text(p.human_approval);
        t.disposition = p.disposition;
      }
      const cp = this.checkpoint(subject, t, a.session!, p.content, e.time);
      t.revision++;
      this.update("threads", t, { checkpoint: cp.id });
      return t;
    }
    if (kind === "revise-engagement") {
      fields(p, [
        "thread",
        "expected_thread_revision",
        "expected_assignment_revision",
        "expected_engagement_revision",
        "mode",
        "exit_condition",
        "reason",
        "authority",
      ]);
      const t = this.get("threads", p.thread);
      Store.owner(t, a);
      Store.revision(t, p.expected_thread_revision);
      integer(p.expected_assignment_revision);
      integer(p.expected_engagement_revision, 1);
      check(
        t.assignment_revision === p.expected_assignment_revision &&
          t.engagement_revision === p.expected_engagement_revision,
        "stale",
        "Engagement assignment changed",
      );
      interaction(p.mode, p.exit_condition);
      text(p.reason);
      links(p.authority);
      check(p.authority.length, "invalid", "Revision authority required");
      const old = this.engagement(t.id);
      check(old, "invalid", "No accepted engagement");
      check(
        p.mode !== old.mode || p.exit_condition !== old.exit_condition,
        "invalid",
        "Agreement unchanged",
      );
      t.engagement_revision++;
      t.assignment_revision++;
      t.revision++;
      const body = {
        id: subject,
        thread: t.id,
        revision: t.engagement_revision,
        assignment_revision: t.assignment_revision,
        mode: p.mode,
        exit_condition: p.exit_condition,
        source_handoff: old.source_handoff,
        source_handoff_revision: old.source_handoff_revision,
        authority: p.authority,
        reason: p.reason,
        time: e.time,
      };
      this.put("engagements", body, { thread: t.id, revision: body.revision });
      this.update("threads", t);
      return body;
    }
    if (kind === "prepare") {
      fields(p, [
        "thread",
        "expected_thread_revision",
        "receiver",
        "brief",
        "authority",
        "expected_handoff_revision",
      ]);
      const t = this.get("threads", p.thread);
      Store.owner(t, a);
      Store.revision(t, p.expected_thread_revision);
      this.get("sessions", p.receiver);
      check(
        p.receiver !== t.coordinator,
        "invalid",
        "Receiver already coordinates",
      );
      fields(p.brief, [
        "ref",
        "outcome",
        "sources",
        "decisions",
        "scope",
        "exclusions",
        "next_action",
        "destination",
        "mode",
        "exit_condition",
      ]);
      for (const k of [
        "ref",
        "outcome",
        "scope",
        "exclusions",
        "next_action",
        "destination",
      ])
        text(p.brief[k]);
      interaction(p.brief.mode, p.brief.exit_condition);
      links(p.brief.sources);
      strings(p.brief.decisions);
      text(p.authority);
      integer(p.expected_handoff_revision);
      const old = one(
        this.db,
        "SELECT body FROM handoffs WHERE id=? ORDER BY revision DESC LIMIT 1",
        subject,
      );
      const prev = old ? JSON.parse(old.body) : null;
      check(
        p.expected_handoff_revision === (prev?.revision ?? 0),
        "stale",
        "Handoff revision changed",
      );
      if (prev)
        check(
          prev.thread === t.id &&
            prev.sender === a.session &&
            !["accepted", "cancelled"].includes(prev.state),
          "conflict",
          "Cannot revise terminal handoff",
        );
      const body = {
        id: subject,
        revision: p.expected_handoff_revision + 1,
        state_revision: 0,
        thread: t.id,
        sender: t.coordinator,
        receiver: p.receiver,
        previous_assignment: t.assignment_revision,
        brief: p.brief,
        brief_hash: digest(p.brief),
        authority: p.authority,
        state: "prepared",
        clarifications: 0,
        questions: [],
        resolution: null,
        acceptance: null,
      };
      this.put("handoffs", body, {
        revision: body.revision,
        thread: t.id,
        sender: body.sender,
        receiver: body.receiver,
      });
      return body;
    }
    if (["send", "clarify", "accept", "cancel"].includes(kind))
      return this.handoff(e, a);
    if (kind === "launch-request") {
      check(
        a.kind === "operator",
        "forbidden",
        "Trusted operator route approval required",
      );
      fields(p, [
        "thread",
        "handoff",
        "role",
        "profile",
        "mode",
        "session",
        "sources",
        "human_approval",
      ]);
      this.get("threads", p.thread);
      for (const k of ["role", "profile", "human_approval"]) text(p[k]);
      links(p.sources);
      check(
        ["create", "resume"].includes(p.mode),
        "invalid",
        "Bad launch mode",
      );
      if (p.handoff !== null) {
        fields(p.handoff, ["id", "revision"]);
        const h = this.get("handoffs", p.handoff.id);
        check(
          h.revision === p.handoff.revision && h.thread === p.thread,
          "stale",
          "Handoff mismatch",
        );
      }
      if (p.mode === "resume") this.get("sessions", p.session);
      else
        check(
          p.session === null,
          "invalid",
          "Create cannot name resume session",
        );
      const body = {
        id: subject,
        ...p,
        revision: 0,
        result: "pending",
        inert: true,
      };
      this.put("launch_requests", body, { thread: p.thread });
      return body;
    }
    if (kind === "launch-result") {
      check(a.kind === "launcher", "forbidden", "Fixture launcher required");
      fields(p, ["expected_revision", "result", "reason"]);
      check(
        ["refused", "unknown"].includes(p.result),
        "invalid",
        "C1 cannot fulfill launch",
      );
      text(p.reason);
      const body = this.get("launch_requests", subject);
      Store.revision(body, p.expected_revision);
      check(body.result === "pending", "conflict", "Request already resolved");
      Object.assign(body, {
        result: p.result,
        reason: p.reason,
        revision: body.revision + 1,
      });
      this.update("launch_requests", body);
      return body;
    }
    throw new ContinuityError("invalid", "Unknown event kind");
  }
  handoff(e: Event, a: Actor): Doc {
    const kind = e.kind,
      p = e.payload,
      extra: Record<string, string[]> = {
        send: ["resolution"],
        clarify: ["questions"],
        cancel: ["reason"],
        accept: [
          "expected_thread_revision",
          "previous_coordinator",
          "checkpoint_id",
          "content",
          "understanding",
        ],
      };
    fields(p, ["revision", "expected_state_revision", ...extra[kind]]);
    const h = this.get("handoffs", e.subject);
    integer(p.revision, 1);
    integer(p.expected_state_revision);
    check(
      h.revision === p.revision &&
        h.state_revision === p.expected_state_revision,
      "stale",
      "Handoff revision changed",
    );
    const receiver = ["clarify", "accept"].includes(kind);
    check(
      a.kind === "session" && a.session === h[receiver ? "receiver" : "sender"],
      "forbidden",
      "Wrong handoff participant",
    );
    const t = this.get("threads", h.thread);
    check(
      t.coordinator === h.sender &&
        t.assignment_revision === h.previous_assignment,
      "stale",
      "Previous assignment changed",
    );
    if (kind === "send") {
      check(
        ["prepared", "clarification-needed"].includes(h.state),
        "transition",
        "Cannot send",
      );
      if (h.state === "clarification-needed") {
        fields(p.resolution, [
          "answer",
          "remaining_questions",
          "direct_discussion",
          "authority_resolved",
        ]);
        text(p.resolution.answer);
        strings(p.resolution.remaining_questions);
        check(
          typeof p.resolution.direct_discussion === "boolean" &&
            typeof p.resolution.authority_resolved === "boolean",
          "invalid",
          "Expected booleans",
        );
        check(
          !p.resolution.remaining_questions.length ||
            p.resolution.direct_discussion,
          "invalid",
          "Remaining questions need direct discussion",
        );
      } else
        check(p.resolution === null, "invalid", "No clarification to resolve");
      h.state = "sent";
      h.resolution = p.resolution;
    } else if (kind === "clarify") {
      check(
        h.state === "sent" && h.clarifications === 0,
        "transition",
        "One clarification round",
      );
      strings(p.questions);
      check(p.questions.length, "invalid", "Questions empty");
      Object.assign(h, {
        state: "clarification-needed",
        questions: p.questions,
        clarifications: 1,
      });
    } else if (kind === "cancel") {
      check(
        ["prepared", "sent", "clarification-needed"].includes(h.state),
        "transition",
        "Cannot cancel terminal handoff",
      );
      text(p.reason);
      Object.assign(h, { state: "cancelled", cancellation: p.reason });
    } else {
      check(
        h.state === "sent",
        "transition",
        "Only sent handoff can be accepted",
      );
      check(
        h.resolution === null || h.resolution.authority_resolved,
        "authority",
        "Unresolved authority",
      );
      Store.revision(t, p.expected_thread_revision);
      check(
        t.coordinator === p.previous_coordinator,
        "stale",
        "Previous coordinator mismatch",
      );
      text(p.understanding);
      interaction(h.brief.mode, h.brief.exit_condition);
      t.coordinator = h.receiver;
      t.assignment_revision++;
      t.engagement_revision++;
      t.revision++;
      const cp = this.checkpoint(
        p.checkpoint_id,
        t,
        h.receiver,
        p.content,
        e.time,
      );
      const engagement = {
        id: e.id,
        thread: t.id,
        revision: t.engagement_revision,
        assignment_revision: t.assignment_revision,
        mode: h.brief.mode,
        exit_condition: h.brief.exit_condition,
        source_handoff: h.id,
        source_handoff_revision: h.revision,
        authority: [{ type: "handoff", ref: h.authority }],
        reason: "Receiver accepted versioned brief",
        time: e.time,
      };
      this.put("engagements", engagement, {
        thread: t.id,
        revision: engagement.revision,
      });
      this.update("threads", t, {
        coordinator: t.coordinator,
        checkpoint: cp.id,
      });
      h.state = "accepted";
      h.acceptance = {
        session: a.session,
        time: e.time,
        understanding: p.understanding,
        checkpoint: cp.id,
        assignment_revision: t.assignment_revision,
      };
    }
    h.state_revision++;
    this.update("handoffs", h);
    return h;
  }
  outcomeEvent(e: Event, a: Actor): Doc {
    const p = e.payload,
      id = e.subject;
    check(a.kind === "session", "forbidden", "Bound working session required");
    if (e.kind === "outcome-scope") {
      fields(p, [
        "expected_revision",
        "title",
        "conditions",
        "authority",
        "reason",
      ]);
      text(p.title);
      text(p.reason);
      links(p.authority);
      check(p.authority.length, "invalid", "Scope authority required");
      check(
        Array.isArray(p.conditions) && p.conditions.length,
        "invalid",
        "Done conditions required",
      );
      for (const c of p.conditions) {
        fields(c, ["id", "text"]);
        text(c.id);
        text(c.text);
      }
      check(
        new Set(p.conditions.map((c: Doc) => c.id)).size ===
          p.conditions.length,
        "invalid",
        "Duplicate conditions",
      );
      integer(p.expected_revision);
      const r = one(this.db, "SELECT body FROM outcomes WHERE id=?", id),
        old = r ? JSON.parse(r.body) : null;
      if (old) {
        Store.revision(old, p.expected_revision);
        check(
          old.owner === a.session,
          "forbidden",
          "Outcome coordinator required",
        );
      } else {
        check(p.expected_revision === 0, "stale", "New outcome expects zero");
        this.get("sessions", a.session!);
      }
      const body = {
        id,
        owner: a.session,
        revision: (old?.revision ?? 0) + 1,
        scope_revision: (old?.scope_revision ?? 0) + 1,
        title: p.title,
        conditions: p.conditions,
        authority: p.authority,
        authored_at: e.time,
        reason: p.reason,
        completion: null,
      };
      if (old) this.update("outcomes", body);
      else this.put("outcomes", body, { owner: a.session });
      this.put("outcome_scopes", body, { revision: body.scope_revision });
      return body;
    }
    fields(p, ["expected_revision", "scope_revision", "acceptance_evidence"]);
    const body = this.get("outcomes", id);
    Store.revision(body, p.expected_revision);
    check(
      body.owner === a.session,
      "forbidden",
      "Outcome coordinator required",
    );
    check(body.scope_revision === p.scope_revision, "stale", "Scope changed");
    check(body.completion === null, "conflict", "Already complete");
    links(p.acceptance_evidence);
    check(
      p.acceptance_evidence.length,
      "invalid",
      "Acceptance evidence required",
    );
    const derived = this.deriveOutcome(body, e.time, 604800);
    check(
      derived.conditions.every((c: Doc) => c.state === "met"),
      "incomplete",
      "Conditions lack current evidence",
    );
    check(
      !derived.actions.some((x: Doc) =>
        ["required-now", "waiting"].includes(x.category),
      ),
      "incomplete",
      "Required actions remain",
    );
    body.revision++;
    body.completion = {
      authored_at: e.time,
      scope_revision: body.scope_revision,
      acceptance_evidence: p.acceptance_evidence,
      conditions: derived.conditions,
    };
    this.update("outcomes", body);
    return body;
  }
  deriveOutcome(outcome: Doc, asOf: string, staleSeconds: number): Doc {
    const at = instant(asOf),
      threads = all(
        this.db,
        "SELECT body FROM threads WHERE outcome=? ORDER BY id",
        outcome.id,
      ).map((r) => JSON.parse(r.body));
    const cps = all(
      this.db,
      "SELECT c.body FROM checkpoints c JOIN threads t ON c.thread=t.id WHERE t.outcome=? ORDER BY c.rowid",
      outcome.id,
    ).map((r) => JSON.parse(r.body));
    const evidence: Doc = {},
      updates: Doc = {};
    for (const cp of cps) {
      for (const o of cp.content.observations ?? []) {
        const old = evidence[o.key];
        if (!old || instant(o.observed_at) > instant(old.observed_at))
          evidence[o.key] = { ...o, checkpoint: cp.id, authored_at: cp.time };
        else if (
          instant(o.observed_at) === instant(old.observed_at) &&
          canonical(o) !==
            canonical(
              Object.fromEntries(
                Object.entries(old).filter(
                  ([key]) =>
                    ![
                      "checkpoint",
                      "authored_at",
                      "stale",
                      "ambiguity",
                    ].includes(key),
                ),
              ),
            )
        ) {
          old.status = "unknown";
          old.ambiguity = "Conflicting observations at same time";
        }
      }
      if (cp.content.scope_revision === outcome.scope_revision)
        for (const c of cp.content.conditions ?? [])
          updates[c.id] = { ...c, checkpoint: cp.id, authored_at: cp.time };
    }
    for (const fact of Object.values(evidence) as Doc[]) {
      const age = (at - instant(fact.observed_at)) / 1000;
      fact.stale = age > staleSeconds || age < 0;
    }
    const conditions = outcome.conditions.map((c: Doc) => {
      const update = updates[c.id];
      let state = update?.state ?? "unknown";
      if (
        update &&
        state === "met" &&
        !update.evidence.every(
          (key: string) =>
            evidence[key]?.status === "supported" && !evidence[key]?.stale,
        )
      )
        state = "unknown";
      return {
        ...c,
        state,
        interpretation: update ?? null,
        remaining: update?.remaining ?? "Evidence missing; completion unknown",
      };
    });
    const actions: Doc[] = [],
      details: Doc[] = [];
    for (const t of threads) {
      const session = this.get("sessions", t.coordinator),
        cp = t.checkpoint ? this.get("checkpoints", t.checkpoint) : null;
      details.push({ thread: t, session });
      if (!cp) continue;
      const proposed = cp.content.actions ?? [
        {
          id: "legacy",
          text: cp.content.next_action,
          category: "required-now",
          actor: { status: "unknown", name: null, evidence: [] },
          destination: { status: "unknown", session: null },
          dependencies: [],
          evidence: [],
          contribution: "Legacy single action; assignment unverified",
        },
      ];
      for (const action of proposed) {
        const closeout = cp.content.closeout;
        const suggestion = closeout?.candidates.find(
          (x: Doc) => x.action_id === action.id,
        );
        const branch = one(
          this.db,
          "SELECT body FROM threads WHERE origin=? AND json_extract(body,'$.origin_action.action_id')=? LIMIT 1",
          t.id,
          action.id,
        );
        const waiting: string[] = [],
          uncertain: string[] = [];
        for (const key of action.dependencies) {
          const fact = evidence[key];
          if (
            !fact ||
            fact.stale ||
            fact.status !== "supported" ||
            !("blocks" in fact)
          )
            uncertain.push(key);
          else if (fact.blocks) waiting.push(key);
        }
        let located = false;
        if (action.destination.status === "verified") {
          const dest = this.get("sessions", action.destination.session),
            obs = dest.observation;
          located = !!(
            obs &&
            obs.state === "available" &&
            obs.location &&
            at - instant(obs.observed_at) >= 0 &&
            at - instant(obs.observed_at) <= staleSeconds * 1000
          );
        }
        actions.push({
          ...action,
          thread: t.id,
          checkpoint: cp.id,
          primary: closeout?.primary_action_id === action.id,
          benefit: suggestion?.benefit ?? null,
          estimate: suggestion?.estimate ?? null,
          selected_branch: branch ? JSON.parse(branch.body) : null,
          waiting_for: waiting,
          dependency_unknown: uncertain,
          destination_note: located
            ? "last observed location available"
            : "session not located; discover existing session",
          recommendation_only: true,
        });
      }
    }
    const activeActions = actions
      .filter((a) => ["required-now", "waiting"].includes(a.category))
      .sort(
        (a, b) =>
          Number(b.primary) - Number(a.primary) ||
          Number(a.category === "waiting") - Number(b.category === "waiting"),
      );
    const candidates = actions.filter((a) =>
      ["optional-follow-up", "separate-opportunity"].includes(a.category),
    );
    const selectedBranches = threads
      .filter((t) => t.origin_action && t.disposition !== "closed")
      .map((t) => {
        const source = this.get("checkpoints", t.origin_action.checkpoint);
        return {
          thread: t.id,
          coordinator: t.coordinator,
          proposed_first_action: source.content.actions.find(
            (a: Doc) => a.id === t.origin_action.action_id,
          ).text,
          checkpoint_pending: t.checkpoint === null,
        };
      });
    return {
      outcome,
      conditions,
      threads: details,
      evidence,
      actions,
      active_actions: activeActions,
      candidates,
      selected_branches: selectedBranches,
      active_wip_threads: [
        ...new Set([
          ...activeActions.map((a) => a.thread),
          ...selectedBranches.map((b) => b.thread),
        ]),
      ],
      completed: outcome.completion !== null,
      ready_to_close: outcome.completion !== null,
      remaining_acceptance: outcome.completion
        ? null
        : "Explicit outcome acceptance required",
      scope_history: all(
        this.db,
        "SELECT body FROM outcome_scopes WHERE id=? ORDER BY revision",
        outcome.id,
      ).map((r) => JSON.parse(r.body)),
      advisory_owner: "Danny",
      record_owner: "Concierge",
      execution_authority: "none",
    };
  }
  outcomeView(id?: string, asOf = now(), staleSeconds = 604800): Doc[] {
    integer(staleSeconds);
    this.db.exec("BEGIN");
    try {
      const result = all(
        this.db,
        `SELECT body FROM outcomes${id ? " WHERE id=?" : ""} ORDER BY id LIMIT 200`,
        ...(id ? [id] : []),
      ).map((r) => this.deriveOutcome(JSON.parse(r.body), asOf, staleSeconds));
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  query(
    thread?: string,
    link?: { type: string; ref: string },
    limit = 50,
  ): Doc[] {
    integer(limit, 1);
    check(limit <= 200, "invalid", "Query limit 200");
    if (link) links([link]);
    this.db.exec("BEGIN");
    try {
      const conditions: string[] = [],
        args: any[] = [];
      if (thread) {
        conditions.push("id=?");
        args.push(thread);
      }
      if (link) {
        conditions.push(
          "EXISTS (SELECT 1 FROM json_each(threads.body,'$.links') l WHERE json_extract(l.value,'$.type')=? AND json_extract(l.value,'$.ref')=?)",
        );
        args.push(link.type, link.ref);
      }
      const records = all(
        this.db,
        `SELECT body FROM threads${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY id LIMIT ?`,
        ...args,
        limit,
      );
      const result: Doc[] = [];
      for (const r of records) {
        const t = JSON.parse(r.body),
          session = this.get("sessions", t.coordinator),
          cp = t.checkpoint ? this.get("checkpoints", t.checkpoint) : null;
        const hs = all(
          this.db,
          "SELECT body FROM handoffs h WHERE thread=? AND revision=(SELECT max(revision) FROM handoffs WHERE id=h.id) ORDER BY id",
          t.id,
        ).map((x) => JSON.parse(x.body));
        const history = all(
            this.db,
            "SELECT body FROM engagements WHERE thread=? ORDER BY revision",
            t.id,
          ).map((x) => JSON.parse(x.body)),
          engagement = history.at(-1) ?? null;
        let exit: Doc | null = null;
        if (engagement)
          for (const item of all(
            this.db,
            "SELECT body FROM checkpoints WHERE thread=? ORDER BY rowid DESC",
            t.id,
          )) {
            const candidate = JSON.parse(item.body),
              value = candidate.content.engagement_exit;
            if (value?.revision === engagement.revision) {
              exit = {
                ...value,
                checkpoint: candidate.id,
                authored_at: candidate.time,
              };
              break;
            }
          }
        const accepted = hs.some(
            (h) =>
              h.state === "accepted" &&
              h.receiver === t.coordinator &&
              h.acceptance.assignment_revision <= t.assignment_revision,
          ),
          issues: string[] = [];
        if (session.identity === null)
          issues.push("provider identity/resume reference unknown");
        if (session.observation === null)
          issues.push("availability/location unknown");
        else if (session.observation.state !== "available")
          issues.push(
            `destination observed ${session.observation.state}; execution ownership unknown`,
          );
        if (!cp) issues.push("semantic checkpoint missing");
        if (t.disposition === "closed" && !engagement)
          issues.push(
            "engagement agreement missing; closure does not prove exit",
          );
        else if (t.disposition === "closed" && !exit)
          issues.push(
            "engagement exit evidence missing; closure does not prove exit",
          );
        else if (t.disposition === "closed" && exit?.assessment !== "met")
          issues.push("engagement exit not met; closure does not prove exit");
        result.push({
          thread: t,
          destination: session,
          checkpoint: cp,
          handoffs: hs,
          engagement,
          engagement_history: history,
          engagement_exit: exit,
          issues,
          suggest_intake_closure: !!(accepted && cp && session.identity),
          runtime_authority: "unchanged",
        });
      }
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  async backup(
    target: string,
    snapshotTime = Date.now() / 1000,
    track = true,
  ): Promise<void> {
    if (track) {
      const { Feedback } = await import("./continuity_feedback.ts");
      new Feedback(this, () => snapshotTime).maintain();
    }
    const path = privatePath(target, true);
    let fd: number;
    try {
      fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
        0o600,
      );
    } catch (e: any) {
      if (e.code === "EEXIST")
        throw new ContinuityError("exists", "Backup exists");
      throw e;
    }
    closeSync(fd);
    if (track)
      run(
        this.db,
        "INSERT INTO feedback_backups VALUES(?,?)",
        path,
        snapshotTime,
      );
    const temporary = `${path}.snapshot-${randomUUID()}`;
    try {
      await sqliteBackup(this.db, temporary);
      chmodSync(temporary, 0o600);
      const db = new DatabaseSync(temporary);
      try {
        run(
          db,
          "INSERT OR REPLACE INTO store_meta VALUES('snapshot_time',?)",
          String(snapshotTime),
        );
        run(db, "DELETE FROM feedback_backups");
      } finally {
        db.close();
      }
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
export function render(rows: Doc[]): string {
  return (
    rows
      .map((r) => {
        const t = r.thread,
          s = r.destination,
          cp = r.checkpoint;
        return [
          `${t.title} [${t.disposition}] ${t.id}`,
          `  Outcome: ${t.outcome}`,
          `  Coordinator: ${s.id}; resume: ${s.identity?.resume_ref ?? "unknown"}`,
          ...(r.engagement
            ? [
                `  Intended mode: ${r.engagement.mode}`,
                `  Exit condition: ${r.engagement.exit_condition}`,
              ]
            : []),
          `  Last observation: ${canonical(s.observation)}`,
          `  Next: ${cp?.content?.next_action ?? cp?.content?.actions?.map((a: Doc) => a.text).join("; ") ?? "unknown — checkpoint missing"}`,
          ...(r.engagement_exit
            ? [
                `  Exit evidence: ${canonical(r.engagement_exit.evidence)}`,
                ...(r.engagement_exit.remaining
                  ? [`  Exit gap: ${r.engagement_exit.remaining}`]
                  : []),
              ]
            : []),
          ...r.issues.map((issue: string) => `  Attention: ${issue}`),
          ...(r.suggest_intake_closure
            ? [
                "  Accepted handoff and durable checkpoint: suggest manual intake closure.",
              ]
            : []),
          "  Observation/resume context grants no execution or runtime authority.",
        ].join("\n");
      })
      .join("\n") || "No matching threads."
  );
}
export function renderOutcomes(rows: Doc[]): string {
  return (
    rows
      .map((r) => {
        const o = r.outcome;
        return [
          `${o.title} — ${r.completed ? "complete; ready to close" : "open"} (scope ${o.scope_revision})`,
          `  Scope authority: ${canonical(o.authority)}`,
          ...r.scope_history
            .slice(0, -1)
            .map(
              (s: Doc) =>
                `  Previous scope ${s.scope_revision} (historical): ${s.conditions.map((c: Doc) => c.text).join("; ")}`,
            ),
          `  Current scope rationale: ${o.reason}`,
          ...r.conditions.map(
            (c: Doc) => `  Done when [${c.state}]: ${c.text} — ${c.remaining}`,
          ),
          ...r.actions.map(
            (a: Doc) =>
              `  ${a.category}: ${a.text} — actor ${a.actor.name ?? "unknown"} (${a.actor.status}); ${a.destination_note}`,
          ),
          ...r.actions.map(
            (a: Doc) =>
              `    Advances: ${a.contribution}; waiting: ${a.waiting_for.join(", ")}; unknown dependencies: ${a.dependency_unknown.join(", ")}`,
          ),
          ...Object.values(r.evidence).flatMap((f: any) => [
            `  Evidence ${f.key} [${f.status}${f.stale ? "; stale" : ""}] observed ${f.observed_at}: ${f.claim} (${f.source.ref})`,
            ...(f.hold_reason || f.release_condition
              ? [
                  `    Hold: ${f.hold_reason ?? "unspecified"}; release when: ${f.release_condition ?? "unspecified"}`,
                ]
              : []),
          ]),
          ...(r.remaining_acceptance ? [`  ${r.remaining_acceptance}`] : []),
          "  Danny advisory view / Concierge records. Recommendations grant no execution authority.",
        ].join("\n");
      })
      .join("\n") || "No matching outcomes."
  );
}
export function renderCompactOutcomes(
  rows: Doc[],
  includeCandidates = false,
): string {
  return (
    rows
      .map((r) => {
        const first = r.active_actions[0];
        return [
          `${r.outcome.title} — ${r.completed ? "complete" : "open"} (${r.outcome.id})`,
          first
            ? `  Primary next: ${first.text} [${first.category}] → ${first.destination.status === "verified" ? first.destination.session : "destination unknown"}`
            : r.selected_branches.length
              ? `  Selected branch: ${r.selected_branches[0].proposed_first_action} → coordinator ${r.selected_branches[0].coordinator}${r.selected_branches[0].checkpoint_pending ? "; checkpoint pending" : ""}`
              : "  Primary next: no required or waiting action",
          ...r.active_actions
            .slice(1)
            .map(
              (a: Doc) =>
                `  Active: ${a.text} [${a.category}] → ${a.destination.status === "verified" ? a.destination.session : "destination unknown"}`,
            ),
          `  Optional/separate candidates: ${r.candidates.length}${includeCandidates ? "" : " (expand with --candidates)"}`,
          ...(includeCandidates
            ? r.candidates.map(
                (a: Doc) =>
                  `    ${a.category}: ${a.text}; benefit: ${a.benefit ?? "unknown"}; size/uncertainty: ${a.estimate ?? "unknown"}; origin: ${a.checkpoint}/${a.id}; ${a.selected_branch ? `selected branch ${a.selected_branch.id}` : "not selected"}`,
              )
            : []),
          "  Danny advisory view / Concierge records. Suggestions grant no execution authority.",
        ].join("\n");
      })
      .join("\n") || "No matching outcomes."
  );
}

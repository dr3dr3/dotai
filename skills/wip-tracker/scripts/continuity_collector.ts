/** One-shot Linux devcontainer collector fixture. No watcher, launch or feedback channel. */
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonical,
  check,
  ContinuityError,
  fields,
  integer,
  MAX_BYTES,
  type Doc,
  type Event,
  Store,
  uuid,
} from "./continuity.ts";
export const allowed = new Set([
  "checkpoint",
  "prepare",
  "send",
  "clarify",
  "accept",
  "cancel",
]);
const owner = process.getuid!();
const relativeTo = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return (
    r === "" || (!r.startsWith(".." + sep) && r !== ".." && !isAbsolute(r))
  );
};
/** /proc/self/fd anchors each lookup to an opened directory, like openat. This fixture is Linux-only. */
export function directory(path: string): number {
  check(
    process.platform === "linux",
    "unsupported",
    "Collector fixture needs Linux /proc/self/fd",
  );
  check(
    isAbsolute(path) && !path.split(sep).includes(".."),
    "unsafe_path",
    "Absolute non-traversing directory required",
  );
  let fd = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const component of path.split(sep).filter(Boolean)) {
      const next = openSync(
        `/proc/self/fd/${fd}/${component}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      closeSync(fd);
      fd = next;
    }
    const info = fstatSync(fd);
    check(
      info.uid === owner && (info.mode & 0o777) === 0o700,
      "unsafe_path",
      "Channel directory must be owner-held 0700",
    );
    return fd;
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}
export function readJson(fd: number, name: string): Doc {
  check(
    !name.includes("/") && name !== "." && name !== "..",
    "unsafe_path",
    "Simple filename required",
  );
  const file = openSync(
    `/proc/self/fd/${fd}/${name}`,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(file, { bigint: true });
    check(
      before.isFile() &&
        before.nlink === 1n &&
        before.uid === BigInt(owner) &&
        (before.mode & 0o777n) === 0o600n,
      "unsafe_file",
      "Owner-held single-link regular 0600 file required",
    );
    check(before.size <= BigInt(MAX_BYTES), "invalid", "Event too large");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size <= MAX_BYTES) {
      const n = readSync(
        file,
        buffer,
        size,
        Math.min(8192, MAX_BYTES + 1 - size),
        null,
      );
      if (!n) break;
      size += n;
    }
    const after = fstatSync(file, { bigint: true });
    check(
      size <= MAX_BYTES &&
        before.size === after.size &&
        before.mtimeNs === after.mtimeNs &&
        before.ctimeNs === after.ctimeNs,
      "unstable",
      "Event changed while read",
    );
    const raw = buffer.subarray(0, size).toString("utf8");
    const event = JSON.parse(raw);
    check(
      raw.trim() === canonical(event),
      "invalid",
      "Event must be canonical JSON without duplicate keys",
    );
    return event;
  } finally {
    closeSync(file);
  }
}
export function publish(fd: number, name: string, value: Doc): void {
  const temporary = `.receipt-${randomUUID()}`;
  const path = `/proc/self/fd/${fd}/${temporary}`;
  const out = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      const data = Buffer.from(canonical(value) + "\n");
      let offset = 0;
      while (offset < data.length)
        offset += writeSync(out, data, offset, data.length - offset);
      fsyncSync(out);
    } finally {
      closeSync(out);
    }
    renameSync(path, `/proc/self/fd/${fd}/${name}`);
    fsyncSync(fd);
  } finally {
    try {
      unlinkSync(path);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
export function bindingFile(path: string): Doc {
  const fd = directory(parse(path).dir);
  try {
    return readJson(fd, parse(path).base);
  } finally {
    closeSync(fd);
  }
}
export class Collector {
  readonly binding: Doc;
  readonly store: Store;
  constructor(store: Store, binding: Doc) {
    fields(binding, [
      "version",
      "session",
      "producer",
      "outbox",
      "inbox",
      "grants",
    ]);
    check(binding.version === 1, "invalid", "Unsupported binding");
    uuid(binding.session);
    check(
      typeof binding.producer === "string" && binding.producer.trim(),
      "invalid",
      "Stable producer required",
    );
    check(
      binding.outbox !== binding.inbox,
      "unsafe_path",
      "Separate outbox and inbox required",
    );
    for (const path of [binding.outbox, binding.inbox])
      check(
        isAbsolute(path) && !path.split(sep).includes(".."),
        "unsafe_path",
        "Absolute non-traversing channel required",
      );
    check(
      !relativeTo(binding.outbox, binding.inbox) &&
        !relativeTo(binding.inbox, binding.outbox) &&
        !relativeTo(store.path, binding.outbox) &&
        !relativeTo(store.path, binding.inbox),
      "unsafe_path",
      "Channel grants include each other or database",
    );
    check(
      Array.isArray(binding.grants) &&
        binding.grants.length > 0 &&
        binding.grants.length <= 20,
      "invalid",
      "Bounded grants required",
    );
    const seen = new Set<string>();
    for (const grant of binding.grants) {
      fields(
        grant,
        ["thread", "assignment_revision"],
        ["handoff", "handoff_revision"],
      );
      uuid(grant.thread);
      integer(grant.assignment_revision);
      check(!seen.has(grant.thread), "invalid", "Duplicate grant");
      seen.add(grant.thread);
      check(
        "handoff" in grant === "handoff_revision" in grant,
        "invalid",
        "Exact handoff revision required",
      );
      if ("handoff" in grant) {
        uuid(grant.handoff);
        integer(grant.handoff_revision, 1);
      }
      store.get("threads", grant.thread);
    }
    store.get("sessions", binding.session);
    this.store = store;
    this.binding = binding;
  }
  authorize(event: Event): void {
    fields(event, ["id", "sequence", "kind", "subject", "time", "payload"]);
    check(allowed.has(event.kind), "forbidden", "Event family not granted");
    check(
      event.payload &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload),
      "invalid",
      "Payload object required",
    );
    const p = event.payload;
    let h: Doc | null = null;
    let thread: string;
    if (["checkpoint", "prepare"].includes(event.kind)) thread = p.thread;
    else {
      h = this.store.get("handoffs", event.subject);
      thread = h.thread;
    }
    const grants = this.binding.grants.filter((g: Doc) => g.thread === thread);
    check(grants.length === 1, "forbidden", "Thread not granted");
    const grant = grants[0],
      t = this.store.get("threads", thread),
      session = this.binding.session;
    if (["accept", "clarify"].includes(event.kind)) {
      check(
        h?.id === grant.handoff &&
          h?.revision === grant.handoff_revision &&
          h?.receiver === session &&
          h?.previous_assignment === grant.assignment_revision,
        "forbidden",
        "Receiver lacks exact handoff grant",
      );
    } else {
      let assignment = grant.assignment_revision;
      if ("handoff" in grant) {
        const accepted = this.store.get("handoffs", grant.handoff);
        check(
          accepted.revision === grant.handoff_revision &&
            accepted.state === "accepted" &&
            accepted.receiver === session,
          "forbidden",
          "Receiver handoff not accepted",
        );
        assignment = accepted.acceptance.assignment_revision;
      }
      check(
        t.coordinator === session && t.assignment_revision === assignment,
        "forbidden",
        "Channel assignment stale",
      );
    }
  }
  collect(limit = 50): Doc[] {
    integer(limit, 1);
    check(limit <= 200, "invalid", "Batch limit 200");
    const result: Doc[] = [];
    const out = directory(this.binding.outbox),
      inbox = directory(this.binding.inbox);
    try {
      const names = readdirSync(`/proc/self/fd/${out}`).filter((n) =>
        n.endsWith(".json"),
      );
      check(
        names.length <= 200,
        "limit",
        "Outbox exceeds 200 pending JSON files",
      );
      const pending: {
        sequence: number;
        name: string;
        event: Event | null;
        failure: Doc | null;
      }[] = [];
      for (const name of names) {
        try {
          uuid(name.slice(0, -5));
          const event = readJson(out, name) as Event;
          check(
            event.id === name.slice(0, -5),
            "invalid",
            "Filename must match event UUID",
          );
          check(allowed.has(event.kind), "forbidden", "Unsupported event");
          integer(event.sequence);
          pending.push({
            sequence: event.sequence,
            name,
            event,
            failure: null,
          });
        } catch (e: any) {
          pending.push({
            sequence: Infinity,
            name,
            event: null,
            failure: {
              event: name.slice(0, -5),
              committed: false,
              ok: false,
              code: e.code ?? "invalid_file",
            },
          });
        }
      }
      pending.sort(
        (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name),
      );
      for (const item of pending.slice(0, limit)) {
        let receipt: Doc;
        try {
          if (item.failure) receipt = item.failure;
          else {
            const applied = this.store.apply(
              item.event!,
              {
                producer: this.binding.producer,
                kind: "session",
                session: this.binding.session,
              },
              (e) => this.authorize(e),
            );
            receipt = {
              event: item.event!.id,
              committed: true,
              ok: applied.ok,
              code: applied.ok ? "accepted" : applied.error.code,
            };
          }
        } catch (e: any) {
          receipt = {
            event: item.name.slice(0, -5),
            committed: false,
            ok: false,
            code: e.code ?? "storage_error",
          };
        }
        publish(inbox, item.name, receipt);
        result.push(receipt);
      }
      return result;
    } finally {
      closeSync(out);
      closeSync(inbox);
    }
  }
}
export function instructions(binding: Doc): string {
  return `# Continuity contribution channel\n\nYour stable session is ${binding.session}. Read trusted assignment context first. Write canonical UTF-8 JSON atomically, mode 0600, to ${binding.outbox}/EVENT_UUID.json. Allowed: checkpoint, prepare, send, clarify, accept, cancel. Use supplied revisions and monotonically increasing producer sequence. Retry unchanged. Accept exact received handoff before execution.\n\nCheckpoint decisions, evidence, position, blockers, questions and concrete actions. Label proposed actors. Receipt: ${binding.inbox}/EVENT_UUID.json. Claim durable acceptance only when committed=true and ok=true. Missing receipt means unknown: retain event. After acknowledgement remove the exact unchanged event. No database reads, launches, feedback prompts or runtime authority. Continue directly with André.\n`;
}

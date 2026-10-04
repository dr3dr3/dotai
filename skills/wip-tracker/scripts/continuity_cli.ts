/** Trusted operator fixture CLI. Flags are inputs, not role authentication. */
import { parseArgs } from "node:util";
import {
  Store,
  canonical,
  render,
  renderOutcomes,
  renderCompactOutcomes,
} from "./continuity.ts";
import { Collector, bindingFile } from "./continuity_collector.ts";
async function input(): Promise<string> {
  let result = "";
  for await (const block of process.stdin) {
    result += block.toString();
    if (Buffer.byteLength(result) > 65536)
      throw new Error("Event exceeds 64 KiB");
  }
  return result;
}
async function main(): Promise<number> {
  let store: Store | undefined;
  try {
    const [command, ...rest] = process.argv.slice(2);
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        db: { type: "string" },
        producer: { type: "string" },
        kind: { type: "string" },
        session: { type: "string" },
        thread: { type: "string" },
        "link-type": { type: "string" },
        "link-ref": { type: "string" },
        limit: { type: "string" },
        outcome: { type: "string" },
        "as-of": { type: "string" },
        json: { type: "boolean" },
        compact: { type: "boolean" },
        candidates: { type: "boolean" },
        binding: { type: "string" },
      },
    });
    if (!values.db) throw new Error("Explicit --db path required");
    if (command === "init") {
      Store.initialize(values.db);
      console.log(canonical({ ok: true, schema_version: 2 }));
      return 0;
    }
    store = new Store(
      values.db,
      !["apply", "backup", "collect"].includes(command),
    );
    let result: any;
    if (command === "apply") {
      if (!values.producer || !values.kind)
        throw new Error("Trusted producer and kind required");
      result = store.apply(JSON.parse(await input()), {
        producer: values.producer,
        kind: values.kind as any,
        session: values.session ?? null,
      });
    } else if (command === "query" || command === "view") {
      if (!!values["link-type"] !== !!values["link-ref"])
        throw new Error("Both link fields required");
      result = store.query(
        values.thread,
        values["link-type"]
          ? { type: values["link-type"], ref: values["link-ref"]! }
          : undefined,
        values.limit ? Number(values.limit) : 50,
      );
      if (command === "view") {
        console.log(render(result));
        return 0;
      }
    } else if (command === "outcomes") {
      result = store.outcomeView(values.outcome, values["as-of"]);
      if (!values.json) {
        console.log(
          values.compact
            ? renderCompactOutcomes(result, values.candidates)
            : renderOutcomes(result),
        );
        return 0;
      }
    } else if (command === "backup") {
      if (positionals.length !== 1) throw new Error("Backup target required");
      await store.backup(positionals[0]);
      result = { ok: true };
    } else if (command === "collect") {
      if (!values.binding) throw new Error("Trusted binding required");
      result = new Collector(store, bindingFile(values.binding)).collect(
        values.limit ? Number(values.limit) : 50,
      );
      result = { ok: result.every((r: any) => r.ok), receipts: result };
    } else throw new Error("Unknown command");
    console.log(canonical(result));
    return result?.ok === false ? 2 : 0;
  } catch (e: any) {
    console.log(
      canonical({
        ok: false,
        error: { code: e.code ?? "invalid", message: e.message },
      }),
    );
    return 2;
  } finally {
    store?.close();
  }
}
process.exitCode = await main();

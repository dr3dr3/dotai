import { parentPort, workerData } from "node:worker_threads";
import { Store } from "../scripts/continuity.ts";
import { Feedback } from "../scripts/continuity_feedback.ts";
const store = new Store(workerData.path);
try {
  const result =
    workerData.kind === "claim"
      ? new Feedback(store, () => workerData.time, true).submit(
          workerData.event,
          workerData.session,
          workerData.producer,
        )
      : store.apply(workerData.event, workerData.actor);
  parentPort!.postMessage(result);
} catch (e: any) {
  parentPort!.postMessage({ error: e.code ?? e.message });
} finally {
  store.close();
}

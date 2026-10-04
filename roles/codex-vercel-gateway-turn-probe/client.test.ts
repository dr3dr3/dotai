import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const client = join(here, "client.ts");
const fake = join(here, "fake-server.ts");
chmodSync(fake, 0o755);

for (const [scenario, ok] of [["complete", true], ["wrong-answer", false], ["failed", false], ["tool", false]] as const) {
  test(`offline protocol ${scenario}`, () => {
    let code = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [client, fake, "openai/gpt-6-luna", `ROE_PILOT_OFFLINE_${scenario.toUpperCase().replaceAll("-", "_")}`], {
        encoding: "utf8", timeout: 5000,
        env: { ...process.env, ROE_FAKE_SECRET_CANARY: "must-not-reach-child" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      code = failure.status ?? 1;
      output = String(failure.stdout ?? "") + String(failure.stderr ?? "");
    }
    assert.equal(code === 0, ok);
    assert.equal(output.includes("CODEX_GATEWAY_TURN_OK"), ok);
    assert.ok(!output.includes("offline-thread"), "protocol identifiers leaked");
    assert.ok(!output.includes("HOST_ENV_LEAKED"), "host environment leaked");
  });
}

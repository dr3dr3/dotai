import assert from "node:assert/strict";
import test from "node:test";
import { plan } from "./run.ts";

test("provider turn scope is limited to a private clone and one networked role container", () => {
  const value = plan("123456abcdef");
  assert.equal(value.installed, "roe-role-pilot-state-v1");
  assert.equal(value.setup.length, 4);
  for (const item of value.setup) {
    assert.ok(item.command.includes("--network=none"));
    assert.ok(!item.command.includes("ROE_PILOT_PROVIDER_TOKEN"));
  }
  const copy = value.setup.find((item) => item.name.includes("-copy-"))!;
  assert.ok(copy.command.includes("type=volume,src=roe-role-pilot-state-v1,dst=/source,volume-nocopy,readonly"));
  for (const item of [...value.setup.filter((candidate) => candidate !== copy), value.role])
    assert.ok(!item.command.some((part) => part.includes("roe-role-pilot-state-v1")));
  assert.ok(value.role.command.includes("--network=bridge"));
  assert.ok(value.role.command.includes("ROE_PILOT_PROVIDER_TOKEN"));
  for (const item of [...value.setup, value.role]) {
    assert.ok(item.command.includes("--cap-drop=ALL"));
    assert.ok(item.command.includes("--security-opt=no-new-privileges=true"));
    assert.ok(item.command.includes("--read-only"));
    assert.ok(!item.command.includes("--privileged"));
    assert.ok(!item.command.some((part) => part.includes("/var/run/docker.sock") || part.includes("/workspace") && !part.includes("seccomp=")));
  }
});

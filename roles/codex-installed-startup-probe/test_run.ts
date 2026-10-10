import assert from "node:assert/strict";
import { test } from "node:test";
import { plan, startupProfile } from "./run.ts";

test("installed role state is mounted read-only only for the copy phase", () => {
  const value = plan("012345abcdef");
  assert.equal(value.installed, "roe-role-pilot-state-v1");
  assert.equal(value.containers.length, 4);
  const sourceMount = `type=volume,src=${value.installed},dst=/source,volume-nocopy,readonly`;
  for (const item of value.containers) {
    const mounts = item.command.filter((arg) => arg.startsWith("type="));
    assert.equal(mounts.includes(sourceMount), item.name.includes("-copy-"));
    assert.ok(mounts.every((mount) => mount.startsWith("type=volume,")));
    assert.ok(item.command.includes("--network=none"));
    assert.ok(item.command.includes("--cap-drop=ALL"));
    assert.ok(item.command.includes("--read-only"));
    assert.ok(
      !item.command.some((arg) => arg.includes("/var/run/docker.sock")),
    );
    assert.ok(
      !item.command.some(
        (arg) => arg.includes("/workspace") && arg.startsWith("type="),
      ),
    );
  }
});

test("startup profile remains credential-free and keeps the role path scope", () => {
  const profile = startupProfile() as {
    filesystem: { read: string[]; allow: string[] };
    network: { allow_domain: string[] };
    environment: { deny_vars: string[] };
  };
  assert.deepEqual(profile.network.allow_domain, []);
  assert.ok(profile.filesystem.read.includes("/tmp/probe"));
  assert.ok(profile.filesystem.allow.includes("/state/pilot/home/.codex"));
  assert.ok(profile.environment.deny_vars.includes("*_TOKEN"));
  assert.ok(profile.environment.deny_vars.includes("HERDR_*"));
});

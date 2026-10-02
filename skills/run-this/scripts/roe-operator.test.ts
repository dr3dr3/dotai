import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandFor, load, run } from './roe-operator.ts';
import type { Request } from './roe-operator.ts';

const SHA = 'a'.repeat(40);
const STACK = 'env-staging/platform-layer/data-refresh-pipeline';
const ID = 'f'.repeat(32);
function request(): Request {
  return { version: 1, id: ID, created_at: 'now', status: 'pending', slug: 'infra-apply', recipe: 'terraform',
    purpose: 'Apply reviewed change', origin: 'test', source: null, expected_revision: SHA, tf_action: 'apply',
    command: ['make', '-C', '/workspace/infrastructure', 'tf-apply', `STACK=${STACK}`] };
}

test('Terraform recipe produces only a named Make target and rejects traversal', () => {
  assert.deepEqual(commandFor('terraform', { stack: [STACK], revision: [SHA], 'tf-action': ['apply'] }).command, request().command);
  assert.throws(() => commandFor('terraform', { stack: ['env-production/platform-layer/../bad'], revision: [SHA] }));
  assert.throws(() => commandFor('terraform', { stack: [STACK], revision: ['short'] }));
});

test('a forged stored command cannot escape its recipe', () => {
  const root = mkdtempSync(join(tmpdir(), 'roe-operator-test-'));
  chmodSync(root, 0o700);
  const prior = process.env.ROE_OPERATOR_INBOX;
  process.env.ROE_OPERATOR_INBOX = root;
  try {
    const path = join(root, `${ID}.json`);
    writeFileSync(path, JSON.stringify({ ...request(), command: ['bash', '-c', 'echo forged'] }));
    assert.throws(() => load(path), /invalid Terraform request/);
  } finally { if (prior === undefined) delete process.env.ROE_OPERATOR_INBOX; else process.env.ROE_OPERATOR_INBOX = prior; }
});

test('Terraform executes directly with its native transcript and exact revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'roe-operator-test-'));
  chmodSync(root, 0o700);
  const bin = join(root, 'bin'); mkdirSync(bin);
  const makeMarker = join(root, 'make-args');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${SHA}'\n`, { mode: 0o700 });
  writeFileSync(join(bin, 'make'), `#!/bin/sh\nprintf '%s\\n' "$*" > '${makeMarker}'\nprintf 'native transcript\\n' > "$TF_LOG_DIR/fake.log"\n`, { mode: 0o700 });
  const oldPath = process.env.PATH, oldInbox = process.env.ROE_OPERATOR_INBOX;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.ROE_OPERATOR_INBOX = root;
  try {
    const path = join(root, `${ID}.json`);
    run(path, { ...request() });
    const saved = load(path);
    assert.equal(saved.status, 'finished');
    assert.equal(saved.exit_code, 0);
    assert.match(saved.log_path || '', /fake\.log$/);
    assert.equal(readFileSync(makeMarker, 'utf8').trim(), `-C /workspace/infrastructure tf-apply STACK=${STACK}`);
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldInbox === undefined) delete process.env.ROE_OPERATOR_INBOX; else process.env.ROE_OPERATOR_INBOX = oldInbox;
  }
});

test('a changed infrastructure revision refuses before Make', () => {
  const root = mkdtempSync(join(tmpdir(), 'roe-operator-test-'));
  chmodSync(root, 0o700);
  const bin = join(root, 'bin'); mkdirSync(bin);
  const makeMarker = join(root, 'make-was-called');
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' '${'b'.repeat(40)}'\n`, { mode: 0o700 });
  writeFileSync(join(bin, 'make'), `#!/bin/sh\ntouch '${makeMarker}'\n`, { mode: 0o700 });
  const oldPath = process.env.PATH, oldInbox = process.env.ROE_OPERATOR_INBOX;
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.ROE_OPERATOR_INBOX = root;
  try {
    run(join(root, `${ID}.json`), request());
    assert.equal(readFileSync(join(bin, 'git'), 'utf8').includes('bbbb'), true);
    assert.throws(() => readFileSync(makeMarker));
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldInbox === undefined) delete process.env.ROE_OPERATOR_INBOX; else process.env.ROE_OPERATOR_INBOX = oldInbox;
  }
});

test('release recipe pins staging SHA and uses only the existing Make ship target', () => {
  const options = { repo: ['api'], summary: ['Tenant settings release'], validation: ['staging'],
    'staging-sha': [SHA], 'validated-sha': [SHA], fleet: ['1'] };
  const built = commandFor('release', options);
  assert.deepEqual(built.command, ['make', '-C', '/workspace', 'release-ship', 'REPO=api',
    'SUMMARY=Tenant settings release', 'VALIDATION=staging', 'VALIDATED_SHA=' + SHA, 'FLEET=1']);
  assert.equal(built.expectedStagingSha, SHA);
  assert.throws(() => commandFor('release', { ...options, repo: ['production-core'] }), /unknown production release/);
  assert.throws(() => commandFor('release', { ...options, repo: ['sso'] }), /fleet must be 1 and is api-only/);
  assert.throws(() => commandFor('release', { ...options, 'staging-sha': ['short'] }), /staging-sha/);
  assert.throws(() => commandFor('release', { ...options, summary: [String.fromCharCode(36) + '(shell touch /tmp/never)'] }), /safe line/);
  assert.throws(() => commandFor('workflow', { repo: ['rock-of-eye/rock-of-eye-api'], workflow: ['prepare-prod-release.yml'], ref: ['master'] }), /release recipe/);
});

test('release refuses when the staging tag no longer points at the reviewed commit', () => {
  const root = mkdtempSync(join(tmpdir(), 'roe-operator-test-'));
  chmodSync(root, 0o700);
  const bin = join(root, 'bin'); mkdirSync(bin);
  const makeMarker = join(root, 'make-was-called');
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\n" "' + 'b'.repeat(40) + '"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'make'), '#!/bin/sh\ntouch "' + makeMarker + '"\n', { mode: 0o700 });
  const oldPath = process.env.PATH, oldInbox = process.env.ROE_OPERATOR_INBOX;
  process.env.PATH = bin + ':' + oldPath;
  process.env.ROE_OPERATOR_INBOX = root;
  try {
    const item: Request = { version: 1, id: ID, created_at: 'now', status: 'pending',
      slug: 'api-ship', recipe: 'release', purpose: 'Ship reviewed API candidate',
      origin: 'test', source: null, expected_staging_sha: SHA,
      command: ['make', '-C', '/workspace', 'release-ship', 'REPO=api',
        'SUMMARY=Tenant settings release', 'VALIDATION=staging'] };
    run(join(root, ID + '.json'), item);
    assert.throws(() => readFileSync(makeMarker));
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldInbox === undefined) delete process.env.ROE_OPERATOR_INBOX; else process.env.ROE_OPERATOR_INBOX = oldInbox;
  }
});

test('release executes the native Make target only when staging still matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'roe-operator-test-'));
  chmodSync(root, 0o700);
  const bin = join(root, 'bin'); mkdirSync(bin);
  const makeMarker = join(root, 'make-args');
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "%s\n" "' + SHA + '"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'make'), '#!/bin/sh\nprintf "%s\n" "$*" > "' + makeMarker + '"\n', { mode: 0o700 });
  const oldPath = process.env.PATH, oldInbox = process.env.ROE_OPERATOR_INBOX;
  process.env.PATH = bin + ':' + oldPath;
  process.env.ROE_OPERATOR_INBOX = root;
  try {
    const item: Request = { version: 1, id: ID, created_at: 'now', status: 'pending',
      slug: 'api-ship', recipe: 'release', purpose: 'Ship reviewed API candidate',
      origin: 'test', source: null, expected_staging_sha: SHA,
      command: ['make', '-C', '/workspace', 'release-ship', 'REPO=api',
        'SUMMARY=Tenant settings release', 'VALIDATION=staging', 'VALIDATED_SHA=' + SHA] };
    const record = join(root, ID + '.json');
    run(record, item);
    const saved = load(record);
    assert.equal(saved.status, 'finished');
    assert.equal(saved.exit_code, 0);
    assert.equal(saved.log_path, null);
    assert.equal(readFileSync(makeMarker, 'utf8').trim(),
      '-C /workspace release-ship REPO=api SUMMARY=Tenant settings release VALIDATION=staging VALIDATED_SHA=' + SHA);
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldInbox === undefined) delete process.env.ROE_OPERATOR_INBOX; else process.env.ROE_OPERATOR_INBOX = oldInbox;
  }
});

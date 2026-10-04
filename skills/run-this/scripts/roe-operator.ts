#!/usr/bin/env node
/** Personal operator inbox. Requests are data; only the operator runs them. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, closeSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, 'capture.sh');
const INFRA_REPO = '/workspace/infrastructure';
const DEFAULT_INBOX = '/workspace/tmp/operator-requests';
const TF_TARGETS = { plan: 'tf-plan', apply: 'tf-apply', 'apply-after-image': 'tf-apply-after-image' } as const;
const RELEASE_REPOS: Record<string, string> = { api: 'rock-of-eye-api', sso: 'rock-of-eye-sso', 'pms-core': 'rock-of-eye-pms-core', aio: 'rock-of-eye-all-in-one-portal', client: 'rock-of-eye-client-portal', partner: 'rock-of-eye-partner-portal' };
type TfAction = keyof typeof TF_TARGETS;
type Recipe = 'auth' | 'diagnostic' | 'local-runtime' | 'workflow' | 'terraform' | 'release';
type Source = { path: string; sha256: string; original: string };
export type Request = {
  version: 1; id: string; created_at: string; status: 'pending' | 'running' | 'finished' | 'unknown';
  slug: string; recipe: Recipe; purpose: string; origin: string; command: string[];
  source: Source | null; expected_revision?: string; expected_staging_sha?: string; tf_action?: TfAction;
  started_at?: string; finished_at?: string; exit_code?: number; log_path?: string | null; error?: string;
};
type Options = Record<string, string[]>;

function fail(message: string): never { throw new Error(message); }
function one(options: Options, key: string, required = false): string {
  const values = options[key] ?? [];
  if (values.length > 1) fail(`--${key} may be specified only once`);
  if (required && !values[0]) fail(`--${key} is required`);
  return values[0] ?? '';
}
function optionsFrom(args: string[]): Options {
  const options: Options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key?.startsWith('--') || !args[i + 1]) fail(`expected --name value, got ${key ?? '(end)'}`);
    const name = key.slice(2);
    if (!['slug', 'purpose', 'origin', 'auth', 'script', 'home', 'task', 'repo', 'workflow', 'ref', 'field', 'stack', 'revision', 'tf-action', 'summary', 'validation', 'validated-sha', 'staging-sha', 'fleet'].includes(name)) fail(`unknown option ${key}`);
    (options[name] ??= []).push(args[i + 1]);
  }
  return options;
}
function inbox(): string {
  const root = resolve(process.env.ROE_OPERATOR_INBOX || DEFAULT_INBOX);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) fail('operator inbox must be owned by this user and private (0700)');
  return root;
}
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function scriptPath(raw: string): string {
  const path = realpathSync(raw);
  const tmp = realpathSync('/workspace/tmp');
  if (lstatSync(raw).isSymbolicLink() || !statSync(path).isFile() || !path.startsWith(tmp + sep)) fail('script must be a regular file under /workspace/tmp');
  return path;
}
export function commandFor(recipe: Recipe, options: Options): { command: string[]; script: string | null; expectedRevision?: string; expectedStagingSha?: string; tfAction?: TfAction } {
  if (recipe === 'auth') {
    const auth = one(options, 'auth', true);
    if (auth === 'aws-sso') return { command: ['aws', 'sso', 'login', '--sso-session', 'rockofeye', '--use-device-code', '--no-browser'], script: null };
    if (auth === 'terraform') return { command: ['terraform', 'login'], script: null };
    if (auth === 'gh') return { command: ['gh', 'auth', 'login'], script: null };
    fail('auth must be aws-sso, terraform, or gh');
  }
  if (recipe === 'diagnostic') return { command: ['bash', scriptPath(one(options, 'script', true))], script: one(options, 'script') };
  if (recipe === 'local-runtime') {
    const home = realpathSync(one(options, 'home', true));
    const task = one(options, 'task', true);
    if (!statSync(home).isDirectory() || !/^[a-z0-9][a-z0-9._-]*$/.test(task)) fail('existing home and simple task ID required');
    const script = scriptPath(one(options, 'script', true));
    return { command: ['roe-coordination', 'run', '--home', home, '--task', task, '--', 'bash', script], script };
  }
  if (recipe === 'workflow') {
    const repo = one(options, 'repo', true), workflow = one(options, 'workflow', true), ref = one(options, 'ref', true);
    if (!/^rock-of-eye\/[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9._/-]+$/.test(ref) || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(workflow)) fail('invalid workflow target');
    if (workflow === 'prepare-prod-release.yml') fail('use the release recipe and Make for production releases');
    const command = ['gh', 'workflow', 'run', workflow, '-R', repo, '--ref', ref];
    for (const field of options.field ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*=[^\n]*$/.test(field)) fail('workflow fields must be key=value without newlines');
      command.push('-f', field);
    }
    return { command, script: null };
  }
  if (recipe === 'release') {
    const repo = one(options, 'repo', true), summary = one(options, 'summary', true);
    const validation = one(options, 'validation', true), stagingSha = one(options, 'staging-sha', true);
    const validatedSha = one(options, 'validated-sha'), fleet = one(options, 'fleet');
    if (!Object.hasOwn(RELEASE_REPOS, repo)) fail('unknown production release repo alias');
    if (!summary.trim() || /[\r\n]/.test(summary) || summary.length > 240 || summary.includes(String.fromCharCode(36)) || summary.includes(String.fromCharCode(96)) || summary.includes(String.fromCharCode(92))) fail('release summary must be one safe line of at most 240 characters');
    if (!['staging', 'local-only', 'ci-only', 'not-applicable'].includes(validation)) fail('invalid release validation');
    if (!/^[0-9a-f]{40}$/.test(stagingSha)) fail('staging-sha must be a full commit SHA');
    if (validatedSha && !/^[0-9a-f]{40}$/.test(validatedSha)) fail('validated-sha must be a full commit SHA when supplied');
    if (fleet && (fleet !== '1' || repo !== 'api')) fail('fleet must be 1 and is api-only');
    return { command: ['make', '-C', '/workspace', 'release-ship', 'REPO=' + repo, 'SUMMARY=' + summary, 'VALIDATION=' + validation,
      ...(validatedSha ? ['VALIDATED_SHA=' + validatedSha] : []), ...(fleet ? ['FLEET=1'] : [])],
      script: null, expectedStagingSha: stagingSha };
  }
  const stack = one(options, 'stack', true), revision = one(options, 'revision', true);
  const action = (one(options, 'tf-action') || 'plan') as TfAction;
  if (!/^env-[a-z0-9-]+\/(foundation|platform|applications|sandbox)-layer\/[a-z0-9-]+$/.test(stack)) fail('STACK must name one env/layer/stack directory');
  if (!/^[0-9a-f]{40}$/.test(revision)) fail('a full 40-character reviewed revision is required');
  if (!(action in TF_TARGETS)) fail('tf-action must be plan, apply, or apply-after-image');
  return { command: ['make', '-C', INFRA_REPO, TF_TARGETS[action], `STACK=${stack}`], script: null, expectedRevision: revision, tfAction: action };
}
function writeRecord(path: string, record: Request): void {
  const temporary = join(dirname(path), `.request-${randomUUID()}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(record, null, 2) + '\n'); }
  finally { closeSync(fd); }
  renameSync(temporary, path);
}
export function load(path: string): Request {
  if (lstatSync(path).isSymbolicLink()) fail('request file is a symlink');
  const item = JSON.parse(readFileSync(path, 'utf8')) as Request;
  if (item.version !== 1 || !/^[0-9a-f]{32}$/.test(item.id) || basename(path) !== `${item.id}.json`) fail('invalid request record');
  validateRequest(item);
  return item;
}
function validateRequest(item: Request): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(item.slug) || !item.purpose || /[\r\n]/.test(item.purpose) || !Array.isArray(item.command)) fail('invalid request metadata');
  const command = item.command;
  if (!command.every(value => typeof value === 'string' && !/[\r\n]/.test(value))) fail('invalid command arguments');
  if (item.recipe === 'terraform') {
    const stack = command[4]?.replace(/^STACK=/, '') || '';
    if (command.length !== 5 || command[0] !== 'make' || command[1] !== '-C' || command[2] !== INFRA_REPO ||
        !Object.values(TF_TARGETS).includes(command[3] as typeof TF_TARGETS[TfAction]) ||
        !command[4]?.startsWith('STACK=') || !/^env-[a-z0-9-]+\/(foundation|platform|applications|sandbox)-layer\/[a-z0-9-]+$/.test(stack) ||
        !/^[0-9a-f]{40}$/.test(item.expected_revision || '') || TF_TARGETS[item.tf_action as TfAction] !== command[3] || item.source) fail('invalid Terraform request');
  } else if (item.recipe === 'auth') {
    const allowed = [
      ['aws', 'sso', 'login', '--sso-session', 'rockofeye', '--use-device-code', '--no-browser'],
      ['terraform', 'login'], ['gh', 'auth', 'login']
    ];
    if (!allowed.some(value => JSON.stringify(value) === JSON.stringify(command)) || item.source) fail('invalid auth request');
  } else if (item.recipe === 'diagnostic') {
    if (!item.source || command.length !== 2 || command[0] !== 'bash' || command[1] !== item.source.path) fail('invalid diagnostic request');
  } else if (item.recipe === 'local-runtime') {
    if (!item.source || command.length !== 9 || command[0] !== 'roe-coordination' || command[1] !== 'run' ||
        command[2] !== '--home' || command[4] !== '--task' || command[6] !== '--' || command[7] !== 'bash' ||
        command[8] !== item.source.path || !/^[a-z0-9][a-z0-9._-]*$/.test(command[5])) fail('invalid local-runtime request');
  } else if (item.recipe === 'workflow') {
    if (command.length < 8 || command[0] !== 'gh' || command[1] !== 'workflow' || command[2] !== 'run' ||
        !/^[A-Za-z0-9._-]+\.ya?ml$/.test(command[3]) || command[4] !== '-R' ||
        !/^rock-of-eye\/[A-Za-z0-9._-]+$/.test(command[5]) || command[6] !== '--ref' ||
        !/^[A-Za-z0-9._/-]+$/.test(command[7] || '') || item.source || (command.length - 8) % 2 !== 0) fail('invalid workflow request');
    if (command[3] === 'prepare-prod-release.yml') fail('use the release recipe and Make for production releases');
    for (let i = 8; i < command.length; i += 2) if (command[i] !== '-f' || !/^[A-Za-z][A-Za-z0-9_-]*=[^\n]*$/.test(command[i + 1])) fail('invalid workflow field');
  } else if (item.recipe === 'release') {
    if (command.length < 7 || command.length > 9 || item.source ||
        JSON.stringify(command.slice(0, 4)) !== JSON.stringify(['make', '-C', '/workspace', 'release-ship']) ||
        !command[4]?.startsWith('REPO=') || !command[5]?.startsWith('SUMMARY=') ||
        !command[6]?.startsWith('VALIDATION=') || !/^[0-9a-f]{40}$/.test(item.expected_staging_sha || '')) fail('invalid release request');
    const tail = command.slice(7);
    if (tail.some((arg, index) => !(index === 0 && arg.startsWith('VALIDATED_SHA=')) && arg !== 'FLEET=1') ||
        tail.filter(arg => arg.startsWith('VALIDATED_SHA=')).length > 1 || tail.filter(arg => arg === 'FLEET=1').length > 1 ||
        (tail.length === 2 && (!tail[0].startsWith('VALIDATED_SHA=') || tail[1] !== 'FLEET=1'))) fail('invalid release request');
    const validated = tail.find(arg => arg.startsWith('VALIDATED_SHA='));
    const options: Options = { repo: [command[4].slice(5)], summary: [command[5].slice(8)],
      validation: [command[6].slice(11)], 'staging-sha': [item.expected_staging_sha],
      ...(validated ? { 'validated-sha': [validated.slice(14)] } : {}),
      ...(tail.includes('FLEET=1') ? { fleet: ['1'] } : {}) };
    if (JSON.stringify(commandFor('release', options).command) !== JSON.stringify(command)) fail('invalid release request');
  } else fail('unknown recipe');
  if (item.source && (dirname(item.source.path) !== inbox() || !/^[0-9a-f]{64}$/.test(item.source.sha256))) fail('invalid source snapshot');
}

function submit(recipe: Recipe, options: Options): void {
  const slug = one(options, 'slug', true), purpose = one(options, 'purpose', true);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug) || /[\r\n]/.test(purpose)) fail('slug or purpose is invalid');
  const built = commandFor(recipe, options);
  const id = randomUUID().replaceAll('-', '');
  const root = inbox();
  let source: Source | null = null;
  if (built.script) {
    const original = scriptPath(built.script), frozen = join(root, `${id}.sh`);
    copyFileSync(original, frozen);
    chmodSync(frozen, 0o600);
    const info = lstatSync(frozen);
    if (!info.isFile()) fail('script snapshot failed');
    source = { path: frozen, sha256: sha256(frozen), original };
    built.command[built.command.length - 1] = frozen;
  }
  const record: Request = { version: 1, id, created_at: new Date().toISOString(), status: 'pending', slug, recipe,
    purpose, origin: one(options, 'origin') || 'unspecified', command: built.command, source,
    ...(built.expectedRevision ? { expected_revision: built.expectedRevision, tf_action: built.tfAction } : {}),
    ...(built.expectedStagingSha ? { expected_staging_sha: built.expectedStagingSha } : {}) };
  writeRecord(join(root, `${id}.json`), record);
  console.log(`Ready for operator review: ${id} (${slug})`);
  console.log(join(root, `${id}.json`));
}
function pending(root: string): Array<{ path: string; item: Request }> {
  return readdirSync(root).filter(name => name.endsWith('.json')).sort().flatMap(name => {
    const path = join(root, name);
    try { const item = load(path); return item.status === 'pending' ? [{ path, item }] : []; }
    catch (error) { console.error(`Invalid request ${name}: ${String(error)}`); return []; }
  });
}
function show(item: Request): void {
  console.log('\n' + item.slug + ' · ' + item.recipe + ' · ' + item.created_at);
  console.log('Purpose:');
  console.log('  ' + item.purpose);
  console.log('Origin:');
  console.log('  ' + item.origin);
  console.log('Command arguments (no shell):');
  item.command.forEach((arg, index) => console.log('  ' + (index + 1) + '. ' + arg));
  if (item.expected_revision) console.log('Expected infrastructure HEAD: ' + item.expected_revision);
  if (item.expected_staging_sha) console.log('Expected staging SHA: ' + item.expected_staging_sha);
  if (item.recipe === 'terraform') console.log('Make owns the interactive TTY and transcript; there is no outer capture wrapper.');
  if (item.recipe === 'release') console.log('Make previews the release and requires the repo alias at its confirmation prompt.');
  if (item.source) {
    console.log('Script snapshot SHA-256:');
    console.log('  ' + item.source.sha256);
    console.log('Original source:');
    console.log('  ' + item.source.original);
    console.log('Inspect frozen snapshot:');
    console.log('  ' + item.source.path);
  }
}
function latestLog(dir: string, prefix = ''): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(name => name.endsWith('.log') && name.startsWith(prefix)).map(name => join(dir, name));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}
export function run(path: string, item: Request): void {
  validateRequest(item);
  if (item.source) {
    const source = item.source;
    if (dirname(source.path) !== inbox() || lstatSync(source.path).isSymbolicLink() || sha256(source.path) !== source.sha256) {
      console.log('Script changed since submission; request refused'); return;
    }
  }
  if (item.recipe === 'terraform') {
    const result = spawnSync('git', ['-C', INFRA_REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (result.status !== 0 || result.stdout.trim() !== item.expected_revision) {
      console.log('Infrastructure HEAD changed or is unavailable; submit a fresh request'); return;
    }
  }
  if (item.recipe === 'release') {
    const repo = item.command[4].slice(5);
    const sha = item.expected_staging_sha;
    const result = spawnSync('gh', ['api', 'repos/rock-of-eye/' + RELEASE_REPOS[repo] + '/git/ref/tags/staging', '--jq', '.object.sha'], { encoding: 'utf8' });
    if (result.status !== 0 || result.stdout.trim() !== sha) {
      console.log('Staging tag changed or could not be verified; submit a fresh release request'); return;
    }
  }
  item.status = 'running'; item.started_at = new Date().toISOString(); writeRecord(path, item);
  const slug = `${item.slug}-${item.id.slice(0, 8)}`;
  const transcriptDir = join(inbox(), `${item.id}-terraform`);
  if (item.recipe === 'terraform') mkdirSync(transcriptDir, { mode: 0o700 });
  const command = executionCommand(item, slug);
  const env = { ...process.env, ...(item.recipe === 'terraform' ? { TF_LOG_DIR: transcriptDir } : {}) };
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env });
  item.log_path = item.recipe === 'terraform' ? latestLog(transcriptDir) : item.recipe === 'auth' || item.recipe === 'release' ? null : latestLog(process.env.RUN_THIS_LOG_DIR || '/workspace/tmp', slug + '-');
  item.finished_at = new Date().toISOString();
  if (result.error || result.signal || result.status === null) { item.status = 'unknown'; item.error = String(result.error || result.signal || 'unknown execution'); }
  else { item.status = 'finished'; item.exit_code = result.status; }
  writeRecord(path, item);
  console.log(`Request ${item.id}: ${item.status}${item.exit_code === undefined ? '' : ` rc=${item.exit_code}`}`);
  if (item.log_path) console.log(`Transcript: ${item.log_path}`);
}
export function executionCommand(item: Request, slug: string): string[] {
  if (item.recipe === 'terraform' || item.recipe === 'auth' || item.recipe === 'release') return item.command;
  if (item.recipe === 'local-runtime') return [CAPTURE, slug, '--', ...item.command];
  return [CAPTURE, slug, '--quiet', '--', ...item.command];
}
async function serve(): Promise<void> {
  const root = inbox();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Operator inbox: ${root}`);
  console.log('Press Enter to refresh; choose a number to inspect; q quits.');
  try {
    while (true) {
      const items = pending(root);
      console.log('\nPending:');
      items.forEach(({ item }, index) => {
        console.log(' ' + (index + 1) + '. ' + item.slug + ' [' + item.recipe + ']');
        console.log('    ' + item.purpose);
      });
      const choice = (await rl.question('Selection: ')).trim();
      if (choice === 'q') return;
      if (!choice) continue;
      const index = Number(choice) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) { console.log('Choose a listed number, Enter, or q'); continue; }
      const { path, item } = items[index];
      const current = load(path);
      if (JSON.stringify(current) !== JSON.stringify(item) || current.status !== 'pending') { console.log('Request changed; refresh first'); continue; }
      show(item);
      if ((await rl.question('Run this exact request? Type run: ')).trim() !== 'run') { console.log('Left pending'); continue; }
      rl.pause();
      try { run(path, item); } finally { rl.resume(); }
    }
  } finally { rl.close(); }
}
function main(): void | Promise<void> {
  const [action, recipeRaw, ...args] = process.argv.slice(2);
  if (action === 'submit') {
    if (!['auth', 'diagnostic', 'local-runtime', 'workflow', 'terraform', 'release'].includes(recipeRaw)) fail('choose a supported recipe');
    submit(recipeRaw as Recipe, optionsFrom(args));
  } else if (action === 'serve') serve();
  else console.log('Usage: node roe-operator.ts submit <recipe> --slug ... --purpose ... | serve');
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(`operator: ${String(error)}`); process.exitCode = 2; }
}

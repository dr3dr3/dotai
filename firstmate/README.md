# Local Firstmate Pilot

This is personal launch glue for Rock of Eye's bounded local crew pilot. It
does not vendor or fork Firstmate.

## Boundaries

- Upstream distro: `/workspace/firstmate`, detached at the commit in
  `pins.env`.
- Private operational home: `/workspace/.firstmate-home`.
- Session backend: Herdr 0.8 or newer.
- Process sandbox: pinned nono with Landlock V6, applied to captains and every
  Claude/Codex process started in a Treehouse slot.
- Pilot backing clone: inside the API repository volume under
  `.treehouse/firstmate-backing/`; it is separate from the checkout mounted at
  `/app`.
- Crew worktrees: Treehouse, forced inside the backing repository.
- Live application validation: local-dev-env's existing `stage-worktree`
  mechanism.

The Treehouse wrapper exists because upstream Firstmate's durable crew lease
and filesystem-identity fixes are not yet merged. It caps active work, refuses
pool exhaustion, rejects the primary checkout and off-volume paths, and rejects
shared dependency symlinks.

## Setup

From the dotai checkout containing this directory:

```bash
bash scripts/setup-firstmate.sh
fm --check
```

Setup asks whether the captain session and crew workers should use Claude Code
or Codex. On a TTY the default is the existing pin, or Claude if none is set.
Non-interactive runs keep an existing pin, default to Claude when unset, or
take `FIRSTMATE_HARNESS=claude|codex` when that is set (which overwrites the
pin). The choice is written to `config/captain-harness`, `config/crew-harness`,
and `config/secondmate-harness` under `FM_HOME`.

Setup also installs a personal `fm` command at `~/.local/bin/fm` (a symlink to
`scripts/firstmate-local.sh`). That directory is already on PATH when personal
dotfiles are installed. It is not a bash alias, so Herdr panes can run it.
Team `local-dev-env` is not modified.

Setup installs the reviewed Treehouse binary, keeps the tracked `treehouse`
command as a fail-closed wrapper, pins the clean Firstmate clone, installs
Firstmate's universal CLI dependencies, and initializes a private `FM_HOME`.
All eight RoE application repositories are registered, each through a clean
backing clone on its own Docker volume, so Firstmate fleet synchronization never
switches or fast-forwards the checkout a container serves at `/app`. The default
branch is read from `origin` per repository rather than assumed, because the
platform repos are on `master` and the shared repos on `main`. A repository with
no checkout under `/workspace/repos` is skipped and named in the setup summary
instead of failing the run, and a project is never registered without one.

`ai-context`, `infrastructure`, and `local-dev-env` are registered as the
checkout itself, since no container serves them. That covers Terraform, alarm,
dashboard, and OTel scouting without moving the Tier 3 `/workspace/infrastructure`
checkout used by its own devcontainer.

Keep `APP_PROJECTS` in `scripts/setup-firstmate.sh` and the captain nono profiles
in step. `tests/firstmate-nono-enforcement.test.sh` reads the setup list and
asserts the profiles allow exactly those eight backing clones, so adding a repo
to one place without the other fails the suite.

Setup also installs the reviewed nono binary and RoE profiles, then places
scoped `claude` and `codex` launchers on the personal PATH. Outside Firstmate
they pass through to the real CLI unchanged. A Firstmate captain or a process
started under `.treehouse/` is instead run through nono. The captain can read
the upstream Firstmate source and write its private operational home and
backing clone (required for Treehouse allocation); a worker can write only its
current Treehouse checkout and harness state. Neither receives the shared
`/app` checkout.
Ambient API keys, GitHub tokens, cloud credentials, and Linear/1Password
variables are stripped. Local untracked `.env*` files make a worker launch fail
closed.

For Codex, setup installs role-specific `fm-captain` and `fm-worker` profiles.
Both suppress reasoning presentation noise, use concise output, preserve
scrollback, and notify on completed turns or approval requests only while the
terminal is unfocused. The captain uses low reasoning effort for supervision;
workers retain high reasoning effort for repository investigation and changes.
The infrastructure project is explicitly trusted so Codex can load any future
project-local `.codex/` layer there.

`fm --check` executes nono's kernel probe and refuses to launch unless Landlock
is enforceable. This environment currently reports Landlock V6 with filesystem,
TCP, signal, abstract-socket, and device-ioctl support.

The first profile version leaves outbound networking enabled because Claude and
Codex need their subscription APIs. Domain-filtered nono proxy mode requires
`CAP_SYS_PTRACE` inside Docker, which this non-root devcontainer deliberately
does not have. Do not add that capability or broaden the profile silently;
review network brokering as a separate hardening change.

### Second-mate homes need their projects relinked

`fm-home-seed.sh` provisions a second mate's projects as independent clones
*inside* the second-mate home, cloned from `origin`. Those paths are off the
`/workspace/repos` volumes, so the Treehouse guard refuses `treehouse get`
there with "project is off the RoE repository volumes". The worker pane never
leaves the project directory and `fm-spawn.sh` then refuses the launch with
"treehouse get did not enter an isolated worktree within 60s" — a timeout that
reports the symptom, not the immediate refusal underneath it.

Worker copies also have to live on the per-repo volumes to be servable at `/app`
by `make stage-worktree`, so the fix is to register the same protected backing
clones the primary home uses:

```bash
bash scripts/firstmate-secondmate-relink-projects.sh <secondmate-home>
```

Run it after every seed, and after adding a project to an existing second mate.
It is idempotent, and `--dry-run` reports what it would change. A clone is only
replaced when it can be proven to hold no unique work — clean worktree, no
stashes, every local branch tracking an upstream it is not ahead of — and
replaced clones are moved to a backup directory it names on exit, never deleted.
It refuses any home without a `.fm-secondmate-home` marker, so it cannot strip
the primary home's registrations.

### Spawning is blocked inside the sandbox

nono applies `deny_credentials` as a required group, so the git and `gh`
credential stores are unreachable inside the sandbox and every `origin` fetch
fails on principle rather than on a real network fault. A spawn hits two such
fetches:

1. `treehouse get`, while it prepares the pool slot. `treehouse-firstmate-guard.sh`
   handles this one: it confines ordinary worker copies to repositories below
   `/workspace/repos`, admits only durable named second-mate leases from the
   exact `/workspace/firstmate` repository, places those leased homes in the
   dedicated `/workspace/.firstmate-secondmates` pool, adds `--no-fetch`, and
   warns on stderr naming the commit and date the copy is cut from. Set
   `ROE_FIRSTMATE_TREEHOUSE_FETCH=1` where credentials do exist.
2. `freshen_spawn_worktree_base` in Firstmate's own `bin/fm-spawn.sh`, called
   *after* the slot has been handed out. At the reviewed pin this fetches
   unconditionally and refuses the launch with "refusing to launch from a
   potentially stale base". It has no opt-out, and adding one means changing
   upstream Firstmate, which this pilot does not fork.

So spawn remains blocked with the sandbox on until (2) is resolved upstream.
`fm --check` does not exercise either path and passes regardless.

Do not grant `$HOME/.config/gh` to a captain profile to work around it. That
credential is push-capable across every registered repository, `deny_credentials` cannot be
dropped by a profile, and Landlock cannot express deny-within-allow on Linux, so
the allow would override the guardrail rather than narrow it.

Until fetching is brokered outside the sandbox, spawn with `fm-sandbox off` and
accept the full bypass for that session.

### Temporarily disabling nono

The secure default is on. While tuning profile grants, use the explicit local
switch:

```bash
fm-sandbox status
fm-sandbox off
fm-sandbox on
```

The setting persists in `~/.config/roe-firstmate/sandbox-mode`; a missing file
means on. When off, both `fm --check` and every Firstmate captain/worker launch
print a warning, and the harness runs with full devcontainer access. Invalid
values fail closed. Ordinary Claude/Codex sessions outside Firstmate remain
unaffected in either mode.

Use off-mode sessions to discover real permission needs, not to pre-authorize
them. Record each logical capability with `fm-permission-note`; entries go to
the private `FM_HOME/data/permission-needs.jsonl` ledger and grant nothing.
Review related entries as a complete workflow before changing a nono profile,
then add both an intended-operation test and an adjacent-denial test. See
[`permissions.md`](permissions.md).

Worker harnesses prepend a Terraform/OpenTofu guard even while nono is off. It
allows only formatting and version inspection and records/refuses plan or
mutation attempts. This is an accidental-use tripwire, not containment:
off-mode workers still have full devcontainer access and could address a real
binary by absolute path. Keep cloud credentials out of workers and supervise
off-mode sessions accordingly.

The setup is idempotent. It does not overwrite existing local Firstmate
configuration files and refuses a dirty or unexpected upstream clone.

## Launch

Start or attach to Herdr from the local-dev-env devcontainer, then run:

```bash
fm
```

That launches the pinned captain harness. Override for one session with
`fm --harness claude|codex`. Cursor and Grok are refused until they have
reviewed RoE nono profiles.

## Validation

A crew worker edits and commits in its Treehouse worktree. It must not run
Composer or Yarn dependency mutation there.

To test the committed branch against the live stack, the captain uses:

```bash
cd /workspace
make stage-worktree REPO=rock-of-eye-api BRANCH=<branch>
make exec-api ARGS="php vendor/bin/pest <test-path>"
make unstage REPO=rock-of-eye-api
```

Only one branch per repository per local-dev-env instance can be staged. A
second concurrently running branch requires the second local-dev-env instance.

For infrastructure, workers edit, statically check, and commit in Treehouse but
never receive plan/apply authority or cloud credentials. The captain classifies
the workspace's canonical CLI/VCS/GitHub trigger, requests explicit permission
for a plan of an exact commit, and summarizes the guarded result. CLI plans run
from a clean exact-SHA worktree on the canonical `/workspace/infrastructure`
volume/toolchain, never from the worker checkout. Apply requires a fresh plan
for the merged revision and a separate human approval through the existing
Terraform Cloud or GitHub environment gate. See
[`terraform-authority-lane.md`](terraform-authority-lane.md).

## Stop conditions

Stop the pilot instead of bypassing a refusal if:

- Treehouse selects or records the primary checkout;
- a slot appears outside the project's `.treehouse/` directory;
- dirty or unlanded work would be reset;
- the staging lock belongs to another task;
- a required guard would need a local Firstmate source patch;
- Landlock or a pinned nono profile is unavailable;
- a Treehouse checkout contains an untracked local `.env*` file;
- a worker requests Terraform plan/apply, merge, deploy, migration,
  production-data, or destructive authority.

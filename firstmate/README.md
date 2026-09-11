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
Firstmate's universal CLI dependencies, and initializes a private `FM_HOME`
with `rock-of-eye-api` as the single pilot project. It creates a clean backing
clone on the same Docker volume so Firstmate fleet synchronization never
switches or fast-forwards the shared `/app` checkout.

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

`fm --check` executes nono's kernel probe and refuses to launch unless Landlock
is enforceable. This environment currently reports Landlock V6 with filesystem,
TCP, signal, abstract-socket, and device-ioctl support.

The first profile version leaves outbound networking enabled because Claude and
Codex need their subscription APIs. Domain-filtered nono proxy mode requires
`CAP_SYS_PTRACE` inside Docker, which this non-root devcontainer deliberately
does not have. Do not add that capability or broaden the profile silently;
review network brokering as a separate hardening change.

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

## Stop conditions

Stop the pilot instead of bypassing a refusal if:

- Treehouse selects or records the primary checkout;
- a slot appears outside the project's `.treehouse/` directory;
- dirty or unlanded work would be reset;
- the staging lock belongs to another task;
- a required guard would need a local Firstmate source patch;
- Landlock or a pinned nono profile is unavailable;
- a Treehouse checkout contains an untracked local `.env*` file;
- a worker requests merge, deploy, migration, production-data, or destructive
  authority.

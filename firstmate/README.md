# Local Firstmate Pilot

This is personal launch glue for Rock of Eye's bounded local crew pilot. It
does not vendor or fork Firstmate.

## Boundaries

- Upstream distro: `/workspace/firstmate`, detached at the commit in
  `pins.env`.
- Private operational home: `/workspace/.firstmate-home`.
- Session backend: Herdr 0.8 or newer.
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
bash scripts/firstmate-local.sh --check
```

Setup installs the reviewed Treehouse binary, keeps the tracked `treehouse`
command as a fail-closed wrapper, pins the clean Firstmate clone, installs
Firstmate's universal CLI dependencies, and initializes a private `FM_HOME`
with `rock-of-eye-api` as the single pilot project. It creates a clean backing
clone on the same Docker volume so Firstmate fleet synchronization never
switches or fast-forwards the shared `/app` checkout.

The setup is idempotent. It does not overwrite existing local Firstmate
configuration files and refuses a dirty or unexpected upstream clone.

## Launch

Start or attach to Herdr from the local-dev-env devcontainer, then run:

```bash
bash scripts/firstmate-local.sh --harness claude
```

Available pilot harness names are `claude`, `codex`, `cursor`, and `grok`.
The launcher refuses unavailable CLIs rather than substituting another
harness.

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
- a worker requests merge, deploy, migration, production-data, or destructive
  authority.

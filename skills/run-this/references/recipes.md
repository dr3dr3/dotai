# run-this — house recipes

Copy the block shape that matches; substitute the slug and the payload. Every
block goes through `capture.sh`, so exit code, stderr, scrubbing, the DONE
marker and the printed path are handled — the recipes only show the payload.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
```

That alias line is part of every block below (it keeps the block short and
survives the skill dir moving, since `~/.claude/skills/run-this` is the symlink
`setup.sh` maintains).

---

## `make` in /workspace goes through the runtime guard

`Makefile:18` runs `scripts/runtime-guard.sh` before any goal. With the
personal roe-coordination provider configured, every goal not on its READ
allowlist is refused unless a Firstmate reservation is held — including
local-only tooling targets that merely aren't listed yet. Two rules:

- **Local tooling → call the underlying command, not the Make target.**
  `aws sso login --sso-session rockofeye --use-device-code --no-browser`, not `make aws-login`. Fewer moving
  parts, and the guard never sees it.
- **Anything that really touches the shared stack** (`make exec-*`, staging,
  `make fresh`, service lifecycle) → the block must go through
  `roe-coordination run --home <home> --task <task-id> -- make …`, with an
  existing Firstmate task. Never suggest a bypass; if there's no task, say so
  and stop.

If a refusal names a target that is plainly read-only/local, the fix is to add
it to `READ` in `dotfiles/tools/roe-coordination/roe-coordination` — that's
André's call and his edit, not the agent's (the permission layer blocks it).

## Interactive auth — gh / terraform

Output is tee'd to his terminal, so the device-code URL is visible. The log
records that it happened; the credentials themselves never print. Don't
`--quiet` an interactive command — he needs to see the prompt. (AWS SSO has its
own section below — check the session before assuming it needs a login.)

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT gh-auth-login -- bash -c 'gh auth login && gh auth status'
```

## Artisan / composer / pest — through `make exec-*`, never raw `docker exec`

`make exec-*` polls a marker file, so it survives the silent-`docker exec`
problem and resolves the `roe-`/`roe2-` prefix from `ROE_INSTANCE`.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT eng-1234-pest --quiet -- make -C /workspace exec-api ARGS="php vendor/bin/pest Modules/Order --ci"
```

Long runs: prefix `EXEC_TIMEOUT=1800` inside a `bash -c` so the variable
reaches `make`:

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT full-suite --quiet -- bash -c 'EXEC_TIMEOUT=1800 make -C /workspace exec-api ARGS="php vendor/bin/pest --ci"'
```

## AWS — check the session first, then usually just run it yourself

Profiles, regions and the least-role table are in `aws.md`. The short version:
`roe-prod` is AuditorAccess (read-only) and prod is in **us-west-2**, not the
profile's default region.

```bash
bash ~/.claude/skills/run-this/scripts/aws-session.sh roe-prod
```

Live + read-only → run it with Bash, no block. Expired → this block (interactive,
never `--quiet`):

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT aws-sso-login -- bash -c 'aws sso login --sso-session rockofeye --use-device-code --no-browser && bash ~/.claude/skills/run-this/scripts/aws-session.sh'
```

## Production SSM — name only, never the value

The three prod parameters (`roe-api-prod-env`, `roe-sso-prod-env`,
`roe-pms-core-prod-env`) are each a whole `.env`. scrub.sh will redact a fetched
value, but the correct move is to not ask for it: `describe-parameters` answers
"did it change", and a `grep -c` answers "is KEY set". These are read-only on
the auditor profile, so with a live session Claude runs them directly; the
block shape is for when the session has to be his.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT prod-ssm-versions -- aws ssm describe-parameters --profile roe-prod --region us-west-2 \
  --query 'Parameters[].[Name,Version,LastModifiedDate]' --output table
```

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT prod-ssm-has-key -- bash -c 'aws ssm get-parameter --profile roe-prod --region us-west-2 --with-decryption \
  --name roe-api-prod-env --query Parameter.Value --output text | grep -c "^SOME_KEY="'
```

## Production database — read-only probe via SSM session

A `SELECT COUNT(*)` always emits exactly one line, so an empty log section is
provably a lost read, not a zero. Prefer counts and `LIMIT`ed samples.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT prod-orphan-count -- bash /workspace/tmp/prod-orphan-count.sh
```

(with the script built from `templates/script.sh`, each query in its own `step`.)

## Long-running sweep / refresh

Always a script (from `templates/script.sh`), always `--quiet`, always a
sentinel per stage. The DONE marker's `elapsed=` tells you how long it really
took, which is what you want for the next estimate.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT aurora-refresh --quiet -- bash /workspace/tmp/aurora-refresh.sh
```

## Replacing a paste

He's about to paste output of something he already ran. Give him the same
command back, wrapped:

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT <slug> -- <the command he ran>
```

## Deploy dispatch (production-touching, human-triggered by policy)

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT deploy-staging-api -- bash -c 'gh workflow run "Deploy API to staging" -R rock-of-eye/rock-of-eye-api && sleep 5 && gh run list -R rock-of-eye/rock-of-eye-api -L 3'
```

Never dispatch the prod deploy workflow from a block — prod is the
`production-*` tag, cut by the release owner, and the tag push is the trigger.

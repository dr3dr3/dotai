---
name: run-this
description: Emit a single copy-pasteable terminal block that André runs himself, which captures ALL its output to a timestamped file under /workspace/tmp/ and prints that path — so he replies with the path, not a wall of pasted output. Use whenever a command needs to run in his terminal rather than through the Bash tool: anything touching production, anything behind an interactive prompt (AWS SSO, sudo, gh auth), anything long-running, anything the permission layer blocks, or when he says "give me a script to run", "give me the commands", "I'll run it", "what should I run", "give me a one-liner", "run this in my terminal". Also use to REPLACE a paste — if he is about to paste large output, hand him this shape instead. Not for commands you can simply run yourself with Bash.
---

# Run This

André's single biggest workflow cost is the paste loop: Claude writes a probe,
he runs it in his terminal, then pastes hundreds or thousands of lines back into
the chat. Measured over 19–24 Aug 2026 that was **44% of everything he typed**
(279k characters across 94 messages, largest single paste 19,805 chars).

This skill kills the return leg. The command captures its own output to a file;
he replies with **one path**; Claude reads the file.

## The contract

1. You emit **one** fenced block he can select and paste — no commentary inside it.
2. It writes everything (stdout **and** stderr) to `/workspace/tmp/<slug>-<UTC>.log`,
   scrubbed of secrets before it touches disk.
3. It records the **command's** exit code and ends with a `=== DONE rc=… ===` marker.
4. It prints the log path as the **last line**, so it's the easy thing to copy.
5. He replies with just the path. You read it — checklist in Step 5.

Never ask him to paste output. If you catch yourself writing "paste the result",
you have used this skill wrong.

## Step 1 — Should this even be his to run?

Prefer running it yourself with Bash. Hand him a block only when there's a real
reason, and **say which one in a single line above the block**:

| Reason | Example |
|---|---|
| **Writes** to production | prod SSM put, prod DB write, a deploy dispatch, anything on `roe-prod-admin` |
| Needs interactive auth | `aws sso login`, `gh auth login`, `terraform login` |
| Blocked by the permission layer | denied or ask-tier command |
| Long-running | fleet sweeps, refreshes, longevity probes |
| Needs his terminal's state | an SSO session or tunnel already open there |

If none apply, just run it. A block he has to paste is a worse outcome than a
tool call, every time.

**AWS specifically: check before you hand over.** The SSO session is often
already live, and every read-only call on an auditor/dev profile is yours to
run:

```bash
bash ~/.claude/skills/run-this/scripts/aws-session.sh roe-prod
```

Live → run it with Bash (`--profile roe-prod --region us-west-2` for prod reads).
Expired → one block for `aws sso login --sso-session rockofeye --use-device-code --no-browser`, then run it yourself.
Profiles, the prod-is-in-us-west-2 trap, and the least-role table:
`references/aws.md`.

## Step 2 — Build the block with `capture.sh`

Don't hand-write the redirect dance. `scripts/capture.sh` is the contract in one
place: `2>&1`, scrubbing, tee-to-terminal, the command's real exit code
(`PIPESTATUS`, not the `echo`'s), the DONE marker, the path last.

**One-off command:**

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT <slug> -- <command and args>
```

**Anything multi-step** — write a script first (Write tool, into
`/workspace/tmp/<slug>.sh`, starting from `templates/script.sh`), then hand him
only the invocation:

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT <slug> --quiet -- bash /workspace/tmp/<slug>.sh
```

Options and rules:

- **Everything after `--` is exec'd verbatim.** Pipelines, redirects, env-var
  prefixes need `bash -c '…'`.
- **`--quiet`** for anything long or noisy — output goes only to the file. Never
  `--quiet` an interactive command; he needs to see the device-code prompt.
- **Slug is kebab-case**, ideally the Linear id plus intent: `eng-2621-fk-impact`.
  capture.sh timestamps it, so re-runs never overwrite the previous evidence.
- **No `|| true`, no `2>/dev/null`, no `set -e` in the script** — the template
  explains why; a probe should finish every step and report each one's rc.
- **Sentinels for empty results.** `rows=0` is an answer; an empty section is a
  lost read. `echo "rows=$(… | wc -l)"`.
- **`/workspace/tmp/` only.** Gitignored, visible in his IDE and to your Read
  tool. Not `/tmp` (invisible to him), not the repo.
- One block. Two blocks means two pastes and a chance to run them out of order.

Worked shapes for every house case (SSO, `make exec-*`, prod SSM, prod DB, deploy
dispatch, replacing a paste) are in `references/recipes.md` — copy from there.

## Step 3 — House gotchas that break captured output

These are Rock of Eye specific and have each cost a session before:

- **`docker exec` can return before the command finished** — and with Octane on,
  artisan produces zero output. Use `make exec-api` / `make exec-sso` /
  `make exec-pms-core ARGS="…"`, which poll a marker file. Never raw
  `docker exec` for artisan/composer/pest.
- **Never hard-code the `roe-` container prefix.** Instance 2 is `roe2-`. The
  `make exec-*` targets resolve it from `ROE_INSTANCE`; capture.sh records which
  instance the run was on in the log header.
- **`make` in `/workspace` is guarded.** The runtime-coordination guard refuses
  any goal not on its READ allowlist unless a Firstmate reservation is held.
  Local tooling → call the underlying command (`aws sso login …`, not
  `make aws-login`). Shared-stack work → `roe-coordination run --home … --task
  … -- make …` with an existing task. Details: `references/recipes.md`.
- **Long runs need a bigger timeout**: `bash -c 'EXEC_TIMEOUT=1800 make exec-api ARGS="…"'`.
- **Secrets.** `scrub.sh` redacts env-style `KEY=value` secrets, JSON secret
  fields, bearer/internal-token headers, Laravel `base64:` keys, AWS/GitHub/
  Linear/Slack/Stripe/OpenAI/Sentry tokens, JWTs, `mysql -p…` and private-key
  blocks — from the output **and** the recorded command line. It is a backstop,
  not permission: still never ask for an SSM value when a name or a `grep -c`
  answers the question. If you see a new secret shape leak, add a pattern to
  `scrub.sh` and a case to `self-test.sh`; there is deliberately no `--no-scrub`.

## Step 4 — Hand it over: Herdr pane first, fenced block as fallback

**Try the pane first.** If this session is running inside Herdr, open a bash
pane next to it with the line already typed — he reads it and presses Enter,
no copy-paste at all:

```bash
bash ~/.claude/skills/run-this/scripts/herdr-pane.sh <slug> [--quiet] -- <command and args>
```

- exit **0** → it printed the pane id. Tell him in one line what's waiting in
  the pane (`run-this: <slug>` is its label) and what you're looking for. Do
  **not** also paste the block — that's the double-handling this skill exists
  to remove.
- exit **3** → not inside Herdr (or the CLI can't reach the session). Fall
  through to the fenced block below. Say nothing about Herdr.
- exit **4** → the pane opened but bash didn't come up; tell him the pane id
  and give the fenced block too.

It never presses Enter for him, and it types exactly one line — pipelines
and multi-step work go through `bash -c '…'` or a script in `/workspace/tmp/`.
The pane is bash, not his default fish, so the block runs exactly as written.

**Fallback — the fenced block.** Above it, one line: what it does and what
you're looking for in the result. Below it, nothing — the path is the last
thing printed, ready to copy.

> Runs the FK-impact probe against staging read-only; I want the orphan counts.

```bash
RT=~/.claude/skills/run-this/scripts/capture.sh
$RT eng-2621-fk-impact --quiet -- bash /workspace/tmp/eng-2621-fk-impact.sh
```

Either way: then stop and wait.

## Step 5 — Read it back

When he replies with the path, read the file and check these **before**
interpreting a single line of content:

1. **Is the DONE marker the last line?** If not, the run was cut short (or is
   still going). Say so; don't interpret a partial log as a result.
2. **`rc=` on the marker.** Non-zero → lead with that and the failing step's
   `[rc=…]` line from the script. A script that "mostly worked" with rc≠0 is a
   failed probe until you've explained the failure.
3. **Header sanity.** `roe_instance:` is the stack you meant? `cwd:` is where the
   relative paths in the command resolve from?
4. **Zero-length sections.** A step with no output between its banner and the
   next is a lost read unless the step printed a sentinel. Re-issue that step,
   don't conclude "nothing found".
5. **`[REDACTED]` where you needed a value** means you asked for a secret. Ask a
   question whose answer isn't one (a count, a key name, a hash prefix) instead.

Only then, interpret the content — and quote the specific lines you're relying
on, so he can spot-check without opening the file.

## Verifying the skill itself

`bash ~/.claude/skills/run-this/scripts/self-test.sh` — 30 checks over
capture.sh and scrub.sh in a throwaway log dir. Run it when asked whether
run-this is working, or after editing either script.
`scripts/aws-session.sh` reports SSO token expiry and whether named profiles
resolve (distinguishing "expired" from "role not assigned").
`scripts/herdr-pane.sh` is exercised for its fallback and usage paths by the
self-test; the live pane path needs a Herdr session (`HERDR_ENV=1`).

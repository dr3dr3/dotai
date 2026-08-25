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
2. It writes everything (stdout **and** stderr) to `/workspace/tmp/<slug>-<UTC>.log`.
3. It prints that path as the **last line**, so it's the easy thing to copy.
4. He replies with just the path. You `Read` it.

Never ask him to paste output. If you catch yourself writing "paste the result",
you have used this skill wrong.

## Step 1 — Should this even be his to run?

Prefer running it yourself with Bash. Hand him a block only when there's a real
reason, and **say which one in a single line above the block**:

| Reason | Example |
|---|---|
| Touches production | prod SSM, prod DB, a deploy dispatch |
| Needs interactive auth | `aws sso login`, `gh auth login`, `terraform login` |
| Blocked by the permission layer | denied or ask-tier command |
| Long-running | fleet sweeps, refreshes, longevity probes |
| Needs his terminal's state | an SSO session or tunnel already open there |

If none apply, just run it. A block he has to paste is a worse outcome than a
tool call, every time.

## Step 2 — Build the block

Two shapes. Pick by size.

**One-off command** — inline, with a stamped log path:

```bash
L=/workspace/tmp/<slug>-$(date -u +%Y%m%d%H%M%S).log
{ <the command> ; } > "$L" 2>&1; echo "exit=$?" >> "$L"; echo "$L"
```

**Anything multi-step** — write a script first (with the Write tool, into
`/workspace/tmp/`), then hand him only the invocation:

```bash
L=/workspace/tmp/<slug>-$(date -u +%Y%m%d%H%M%S).log
bash /workspace/tmp/<slug>.sh > "$L" 2>&1; echo "exit=$?" >> "$L"; echo "$L"
```

Rules for the block:

- **`2>&1` always. Never `2>/dev/null`.** A diagnostic that hides stderr is
  worse than no diagnostic.
- **Never `|| true`.** It discards the exit code you are trying to learn.
- **Record the exit code in the file.** You cannot see his terminal.
- **End with a completion marker** for anything long — `echo "=== DONE ==="` as
  the script's last line — so a truncated log is distinguishable from a
  still-running one.
- **`/workspace/tmp/` only.** It is gitignored and resolves in both his IDE and
  your `Read` tool. Not `/tmp` (invisible to him), not the repo (pollutes git).
- **Timestamp every filename.** He re-runs things; same-name files silently
  overwrite the evidence of the previous run.
- Keep it to one block. Two blocks means two pastes and a chance to run them out
  of order.

## Step 3 — House gotchas that break captured output

These are Rock of Eye specific and have each cost a session before:

- **`docker exec` can return before the command finished** — and with Octane on,
  artisan produces zero output. Use `make exec-api` / `make exec-sso` /
  `make exec-pms-core ARGS="…"`, which poll a marker file. Never raw
  `docker exec` for artisan/composer/pest.
- **Never hard-code the `roe-` container prefix.** Instance 2 is `roe2-`. The
  `make exec-*` targets resolve it from `ROE_INSTANCE`; a raw `docker exec
  roe-api …` silently hits the wrong stack.
- **Zero bytes is not zero results.** If the block might produce an empty file,
  make it emit a sentinel (`echo "rows=$(…)"`) so an empty log is provably a
  lost read rather than a real "nothing found".
- **Long runs need a bigger timeout**: `EXEC_TIMEOUT=1800 make exec-api ARGS="…"`.
- **Never print an SSM env blob or a secret into the log** — one parameter is a
  whole `.env`, and the log file is shareable.

## Step 4 — Hand it over

Above the block, one line: what it does and what you're looking for in the
result. Below it, nothing — the path is the last thing printed, ready to copy.

> Runs the FK-impact probe against staging read-only; I want the orphan counts.

```bash
L=/workspace/tmp/eng-2621-fk-impact-$(date -u +%Y%m%d%H%M%S).log
bash /workspace/tmp/eng-2621-fk-impact.sh > "$L" 2>&1; echo "exit=$?" >> "$L"; echo "$L"
```

Then stop and wait. When he replies with the path, `Read` it — and if it looks
truncated or the exit code is non-zero, say so before interpreting the contents.

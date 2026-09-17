# Atuin for Fish and AI terminal sessions

Atuin provides searchable terminal history with command text, directory, timestamp,
duration, exit status, and author. Use it to recover working commands and find
repeated terminal friction worth fixing in agent guidance.

## Ownership and setup

- **dotfiles** installs Atuin and initializes Fish, Bash, and Zsh. Fish initialization
  lives in `.dotfiles/fish/.config/fish/config.fish`, after fzf so Atuin owns Ctrl-R.
  When that managed config is absent, `scripts/setup-atuin.sh` supplies a Fish
  `conf.d/atuin.fish` fallback. Setup removes only its exact obsolete fallback when
  the main Fish config already initializes Atuin; custom snippets are preserved.
- **dotai** registers native Claude Code and Codex hooks through
  [`scripts/setup-atuin-hooks.sh`](../scripts/setup-atuin-hooks.sh). Both `setup.sh`
  and `scripts/setup.sh` invoke it. It skips with instructions if Atuin is absent;
  rerun it after installing dotfiles if setup happened in the opposite order.
- The guide lives here because agent capture and analysis are owned by dotai.

In the Rock of Eye devcontainer, run these from any shell, including Fish:

```sh
bash /workspace/dotfiles/scripts/setup-atuin.sh
bash /workspace/.ai/dotai/scripts/setup-atuin-hooks.sh
```

For another checkout, substitute its paths. The shell installer is also called by
normal dotfiles installation, macOS bootstrap, and devcontainer setup. The agent
installer merges the native hooks without replacing other hooks; rerunning does
not add duplicates. Atuin 18.21.0 was verified for this guide.

Native registration targets `~/.claude/settings.json` and `~/.codex/hooks.json`.
This version's native installer uses those default home paths; alternate
`CLAUDE_CONFIG_DIR`/`CODEX_HOME` profiles need separate verification. Existing
persistent home symlinks are followed. Atuin must also be on the agent's PATH.

No account or sync is required. Dotfiles defaults to `auto_sync = false` and
`update_check = false`, preserving existing local settings. History, credentials,
and encryption keys stay outside either Git repository. Run `atuin info` to locate
this machine's data; don't assume host and container share a database.

## Try Fish

Open a fresh Fish terminal. No change to the account's login shell is required.

```fish
printf 'hello from atuin practice\n'
bind \cr
```

The binding should include `_atuin_search`. Press **Ctrl-R**, search for
`atuin practice`, then press **Tab** to insert the selected command for editing.
Change its message and run it. **Esc** closes search; Ctrl-R inside search cycles
its scope. Follow the UI's Enter label: whether Enter edits or executes depends
on settings. The managed integration leaves the ordinary Up arrow available.

Useful noninteractive queries (also valid in Fish):

```sh
atuin search --limit 10 'atuin practice'
atuin search --cwd "$PWD" --limit 20
atuin search --exit 127 --limit 20
atuin stats
```

If Ctrl-R opens fzf, check that Atuin initializes after fzf in `config.fish`.
If commands are absent, check `status is-interactive`, `type -a atuin`, and
`atuin doctor`. An inherited `ATUIN_SESSION` alone does not prove hooks are active.
Fish private mode and configured exclusion filters can suppress recording.

## Enable and verify agent capture

Restart Claude Code and Codex after installation. In **Codex**, open `/hooks` and
review/trust the new Atuin definitions. Codex skips new or changed untrusted hooks;
the installer deliberately does not bypass this review or write trust hashes.
The handlers are `atuin hook codex`, matched to Bash tool events.

Codex normalizes `exec_command` to the hook tool name `Bash`, so the native
`^Bash$` matcher is correct. For long-running commands, completion may arrive when
`write_stdin` polls the original command. A shell command typed by a human to start
an agent is not a record of the commands that agent subsequently executes.

In a fresh session of each agent, ask it:

> Run exactly `printf 'atuin-live-agent-check\n'` once using your shell tool.

Then, from your Fish terminal:

```sh
atuin search --author claude-code --include-duplicates 'atuin-live-agent-check'
atuin search --author codex --include-duplicates 'atuin-live-agent-check'
atuin search --author '$all-agent' --include-duplicates --limit 20
```

Use a new marker on subsequent checks so old rows cannot create a false positive.
Confirm the author and completed exit/duration, not just a matching command. An
entry stuck at exit `-1` needs investigation; don't count it as a normal failure.
Agent commands are hidden from the ordinary interactive history view by default;
use explicit CLI author filters when auditing them.

### Repeatable local handler check

```sh
python3 /workspace/.ai/dotai/scripts/verify-atuin-hooks.py
```

This verifies exactly one native registration for every event, feeds synthetic
pre/post events to both real Atuin handlers, executes harmless commands, and checks
exit 0 and 7, duration, author, intent, directory, agent filtering, and the failure
handler. It uses a temporary database and removes it afterward, keeping synthetic
agent rows out of your real history. It requires Python 3 and Atuin on PATH.

**This is a handler test, not proof that a running agent dispatches its hooks.**
The fresh-session check above is the final integration check.

### Verification performed on 2026-09-12

- Atuin 18.21.0: both native hook installers succeeded; rerunning skipped duplicates.
- Fresh interactive Fish: Ctrl-R opened Atuin, found a real probe, and Tab inserted
  it into the command line. SQLite confirmed shell `fish`, exit 0, and duration.
- Both native agent handlers passed the isolated success and failure checks.
- Live agent dispatch remains to be checked after restart and Codex `/hooks` trust
  review. No claim of full live Claude/Codex capture is made by the isolated test.

## Use history to improve agent workflows

Collect several representative sessions, retaining duplicates for frequency and
retry analysis:

```sh
atuin search --author '$all-agent' --include-duplicates --after '1 week ago' --limit 200
atuin search --author codex --exit 127 --include-duplicates --limit 50
atuin search --author claude-code --cwd "$PWD" --include-duplicates --limit 50
```

Start with specific questions:

- Which command families repeatedly fail before a successful alternative?
- Where do broad searches cause repeated refinements or whole-file reads?
- Where are structured JSON/YAML results being scraped with text pipelines?
- Which repeated sequences deserve a script, Make target, or skill?

Prefer focused `jq`/`yq` queries and scoped `rg` searches where they reduce work.
`eza` and `bat` can help human reading, but paging, decorations, and color aren't
inherently useful to an agent. Evaluate a CLI by correctness and useful output,
not novelty. Turn recurring evidence into a few concrete guidance changes, then
compare retries, relevant output size, and task outcomes on similar work.

Ordinary history does not contain stdout/stderr, token usage, or task outcomes.
Exit 0 is not proof of task success; `rg` exit 1 can simply mean no matches.
Atuin's `PostToolUseFailure` handler records generic exit 1; a `PostToolUse` payload
without an exit code defaults to 0. Commands may be compound shell invocations,
and hook execution context determines recorded cwd/session. Validate metadata
against a real task before using it as a precise metric. Inspect relevant agent
transcripts when history alone cannot explain a pattern.

Keep raw histories local when possible: commands can contain sensitive arguments.
Share sanitized findings rather than committing an unfiltered history export.

## References

- [Atuin basic usage](https://docs.atuin.sh/18.21/guide/basic-usage/)
- [Atuin agent hooks](https://docs.atuin.sh/18.21/guide/agent-hooks/)
- [Atuin shell integration](https://docs.atuin.sh/18.21/guide/shell-integration/)
- [Codex hook coverage and trust](https://learn.chatgpt.com/docs/hooks)

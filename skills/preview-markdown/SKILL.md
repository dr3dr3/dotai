---
name: preview-markdown
description: Show a local Markdown file in Glow in a new sibling Herdr pane when the user asks to preview Markdown, show a document in Glow, or present a generated Markdown file beside the session. Does not open previews merely because a task creates or edits Markdown.
---

# Preview Markdown in Herdr

Present the requested file using the installed Glow reader. A request to write a document and show it includes opening its preview after saving it.

1. Resolve the requested file to an existing absolute path. If the document was just created, use that file rather than a separate presentation copy.
2. Confirm `HERDR_ENV=1` and that `herdr` and `glow` are available. If outside Herdr, explain that a sibling pane cannot be opened from this session and provide the safely quoted `glow -p -- <absolute-path>` command. Do not control another session or install tools implicitly.
3. Read `herdr --skill` unless its current instructions are already in context. Use `herdr pane` to check the installed command syntax. Follow applicable local coordination rules.
4. Inspect the caller with `herdr pane layout --current`. Honor a requested direction; otherwise split right when there is enough width to read comfortably, or down for a narrow pane.
5. Create one sibling pane in the current tab, preserving the caller's working directory and focus:

   ```bash
   herdr pane split --current --direction right --cwd "$PWD" --no-focus
   ```

   Substitute `down` when appropriate. Parse the new pane ID from `.result.pane.pane_id`; never infer it from sidebar order or target the UI-focused pane.
6. Use `herdr pane run <returned-pane-id> <command>` to execute `glow -p -- <absolute-path>` in the new pane. The command argument is shell code: safely shell-quote the file path (for example with Python `shlex.quote`) and pass the full command as one CLI argument. JSON escaping alone is not shell quoting.
7. Read the new pane's visible output to confirm that the document opened; report any error without creating more panes. Leave the preview open for the user. Briefly identify the file and tell them to select the preview pane to scroll and press `q` to exit Glow.

Use ordinary pane commands, not `herdr agent start`: the preview is a reader, not another agent. Do not send commands to an occupied existing pane or close unrelated panes. This pager preview is a snapshot; do not promise automatic refresh when the file changes. If the user asks to refresh an existing preview, inspect that specific preview pane before interacting with it.

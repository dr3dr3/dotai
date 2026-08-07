# Channel paste-fidelity reference

The rule everywhere: **emit what the app renders, not markdown source.** A `**bold**` that
Slack does not understand shows up in the posted message as two literal asterisks either
side of the word.

## Quick table

| | Bold | Italic | Bullets | Headings | Links | Code |
|---|---|---|---|---|---|---|
| **Slack** | `*bold*` | `_italic_` | `•` char | none — use `*Bold line*` | bare URL | `` `inline` `` |
| **Teams** | none | none | `•` char | none | bare URL | none |
| **WhatsApp** | `*bold*` | `_italic_` | `•` char | none | bare URL | ` ```mono``` ` |
| **Email** | none | none | `•` char | plain line + blank line | bare URL | none |
| **LinkedIn** | none | none | `•` char | none | bare URL | none |

"none" means **write no marker at all** — carry the structure with line breaks and bullets.

Backticks earn their place only around a literal token the reader has to type or match —
a branch name, a flag, a command, an env var. Never for emphasis, and never in a channel
where they paste as visible characters.

---

## Slack

Slack uses **mrkdwn**, not markdown. They are different formats with a deliberately
confusing pair of names.

- **Bold is a single asterisk**: `*bold*`. Standard markdown `**bold**` renders as
  `*bold*` with visible asterisks.
- Italic `_italic_`, strikethrough `~strike~`, inline code with backticks.
- **List markers do not render.** `- item` posts as a literal hyphen. Use the `•`
  character, one per line.
- **Headings do not exist** in a normal message. Use a bold line followed by the bullets.
- **Strip `<@Uxxxx>` mention syntax.** It only resolves when posted through the API — in
  pasted text it shows as the raw string. Write the plain `@name` and tell André to retype
  the mention so Slack's autocomplete fires.
- **`[text](url)` does not work.** Slack's own link syntax is `<url|text>`, which also
  only resolves via API. Paste bare URLs.
- Blank lines survive paste and are the main structural tool. Use them.

### Delivery trap — externally-shared channels (verified 2026-08-04)

Group DMs and channels with external members are **Slack Connect** channels. The API
cannot post to them:

- `slack_send_message` fails with `mcp_externally_shared_channel_restricted`.
- `slack_send_message_draft` reports success and returns a `draft_id`, but **the draft
  never appears in Slack.** It is a silent no-op.

Both paths are dead ends. Copy-paste is the only route — which is what this skill produces
anyway. Internal-only channels are unaffected.

---

## Microsoft Teams

Teams is the least predictable target. The compose box interprets *some* markdown as you
type it, but pasted text is handled differently again, and the behaviour differs between
the desktop app, the web client, and Outlook-hosted Teams.

**Therefore: use no inline markers at all.** Bullets and line breaks only. A bold line in
Teams is a short line on its own, not a marked-up one.

Teams collapses long messages behind a "see more" fold, so the first two lines carry
disproportionate weight. Headline and ask both belong above the fold.

---

## WhatsApp

Same marker set as Slack: `*bold*`, `_italic_`, `~strike~`, ` ```monospace``` `.

- No headings, no lists, no tables.
- **Assume a phone screen.** Short lines, and shorter overall than any other channel —
  aim well under the executive ceiling.
- Consecutive blank lines get collapsed. One blank line between blocks, no more.
- A long message on WhatsApp reads as a wall. If it needs more than about six lines, it
  probably wants to be an email with a WhatsApp nudge pointing at it.

---

## Email

- Give the **subject line separately, above the top rule**, so it is copied on its own.
  A subject is a headline, not a topic: "Prod release Thursday — need your sign-off by
  Wed", not "Release update".
- Body is plain prose plus `•` bullets. No markers.
- Structure with a plain line of text and a blank line where you would otherwise use a
  heading.
- No signature block. André's client adds it.

---

## LinkedIn and generic web boxes

No formatting survives at all — not even the marker characters, which post literally.
Structure comes entirely from line breaks and `•` characters. Assume the first three lines
are all anyone reads.

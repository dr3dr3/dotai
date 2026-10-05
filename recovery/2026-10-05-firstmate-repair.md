# Recovery provenance — `recovery/2026-10-05-firstmate-repair`

**Recovery-only. Not for merge. Must be split and reviewed before any PR.**
Copied by the `init-ai-setup` coordination session under André's 2026-10-05
preservation authorization. `init-ai-setup` did **not** author this content.

- Source checkout: `/workspace/.ai/dotai` (shared), branch `main`, HEAD
  `cd99829e30c518160a78819680f8f358b7da9fb1`, dirty (126 status entries), 8 behind
  `origin/main`. Source was read only; nothing staged, switched or cleaned there.
- Clean base: `origin/main` `79b903aaeb28db6a71f3c4a04f1b699bd35e2bc3`.
- Originating session: the original Firstmate/nono session (not identifiable from Git;
  untracked/modified files carry no author). Source mtimes 2026-09-28 → 2026-10-05.
- Group: Firstmate home/startup and coordination repair.

## Files (SHA-256 of source == committed bytes)

```
ec7da066e2a13e7d429f2bf64caa1a6d7dbba74d0a9227586b9edd9769962b3f  firstmate/nono/roe-firstmate-claude-captain.json  (source: /workspace/.ai/dotai/firstmate/nono/roe-firstmate-claude-captain.json, mode 644)
63921fabc933bdcf9175cf5a5db163bdcf8fc7d98ef58848ff771e5cfd54a975  firstmate/nono/roe-firstmate-codex-captain.json  (source: /workspace/.ai/dotai/firstmate/nono/roe-firstmate-codex-captain.json, mode 644)
5b9f48a97392651c7bc2a90ccd009a56a29a6679a890912848f568b410b589f3  firstmate/pins.env  (source: /workspace/.ai/dotai/firstmate/pins.env, mode 644)
c3ffea0918bdbacae7c988dbb37ddb870e5a7e3ea9263a203b1b00d6c7cce108  scripts/firstmate-harness-sandbox.sh  (source: /workspace/.ai/dotai/scripts/firstmate-harness-sandbox.sh, mode 755)
92a8dba9fcb5214920d9df775c6de8cd5dee3fd1c84cd2a3bb568786fef92f87  tests/firstmate-harness-sandbox.test.sh  (source: /workspace/.ai/dotai/tests/firstmate-harness-sandbox.test.sh, mode 755)
52456957466fdeb34eba24405cbaa656783b9ceeb7c735ea9e225f84489069bb  tests/firstmate-leases.test.sh  (source: /workspace/.ai/dotai/tests/firstmate-leases.test.sh, mode 755)
07d62b43700e220840bc7fb3e126aa22767141c297c0cd2cb8bca398d08d336f  scripts/firstmate-captain-home.py  (source: /workspace/.ai/dotai/scripts/firstmate-captain-home.py, mode 644)
d8182f2d6a07e5ccbda0551b1d1008be2f28e4833e84f73bb1e15760715fb879  tests/test_firstmate_captain_home.py  (source: /workspace/.ai/dotai/tests/test_firstmate_captain_home.py, mode 644)
```

Six files modify base files; each diff against `origin/main` was reviewed and
contains only the local change (no reversal of upstream #65 content).

## Exclusions (left untouched in the source checkout)

- `skills/run-this/SKILL.md` — reviewed: a pre-#55 draft (lacks the release route),
  matches no commit; run-this lineage, not Firstmate. Recorded in the coordinator report.
- `scripts/setup.sh`, `firstmate/nono/roe-firstmate-codex-worker.json`,
  `tests/firstmate-nono-enforcement.test.sh`, `tests/codex-config.test.sh` — byte-identical
  to `origin/main` (#65); nothing to preserve.
- Everything else in the shared checkout belongs to other recovery branches or owners.

## Unresolved ambiguity

- `roe-firstmate-claude-captain.json` adds `read_file` grants for `roles/nono-probe/*`
  (role-sandbox content) — mixed snapshot; split before any PR.
- `roe-firstmate-codex-captain.json` adds read of `$HOME/.config/gh` and axi tool dirs —
  needs a security review before any PR.
- `pins.env` bumps `FIRSTMATE_COMMIT` and raises slots 4→10 and active tasks 2→5 —
  a capacity-policy change needing explicit approval.
- `scripts/firstmate-captain-home.py` is Python; André's direction (2026-10-05) is
  TypeScript for our code. Preserved as-is; port before any PR.

## Offline validation

`python3 -B -m unittest tests/test_firstmate_captain_home.py` (6 passed, hermetic tempdir);
`bash -n` on the three shell files; JSON parse of both profiles. The two shell test
suites were **not** run: they create worktrees/dirs under shared `/workspace` runtime.

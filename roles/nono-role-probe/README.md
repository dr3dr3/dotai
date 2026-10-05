# Generated role profile and native Codex check

Passed on 2026-09-28. Human-only execution under Firstmate registration.
`python3 run.py` checks pins and prints the plan; --execute runs one container.

Profile is produced by scripts/roe-role.profile with synthetic context, role state,
output and dummy auth paths. No personal auth is read or copied. Protected/sibling
fixtures exist and are accessible before sandboxing. Intended reads and writes
must pass while protected-state/sibling reads and HOME/context/auth writes fail;
an exec child must inherit denial. Empty dummy auth is just a readable fixture,
not a valid credential or test of authentication.

Pinned native Codex0.157.0 runs --version, --help and app-server --help only.
No agent turn, app-server process, socket operation, login, model call or network
request is included. This tests binary loading/CLI parsing under the candidate
profile; it does not prove an interactive session or provider connection works.

Same pinned image/engine/nono/pidfd-only policy, network none, no host mounts,
cap-drop ALL, read-only root and no-new-privileges. Native Codex is about247MB:
tmpfs512MiB and memory/swap1GiB, CPU1, pids64; existing60/75-second timeouts remain.
Exact container removal and all-zero capabilities required. No automatic recovery
or fallback. Input hashes include the generator, profile, scripts, policy and binary.

The old native-wrapper path disappeared during separately owned setup work.
The current executable is pinned directly; changes cause refusal, not auto-upgrade.
Real role launcher executable resolution still needs reconciliation before activation.

Evidence: /workspace/tmp/ai-pilot-nono-role-20260928125737.log, DONE rc=0 elapsed1s.
All declared checks passed; exact container removed and runtime available.
Remaining exclusions above still apply.

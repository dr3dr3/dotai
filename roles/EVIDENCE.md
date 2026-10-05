# Role and sandbox acceptance evidence

An index of the operator-run acceptance captures behind the AI pilot's role,
sandbox and checkpoint work, taken 2026-09-28 → 2026-10-04. It records what each
capture shows, so the evidence survives even though the raw logs do not live in
this repository.

- **Evidence, not active code.** The probes listed here are finished. None of them
  is merged as runnable code, and nothing here should be re-run without a fresh,
  reviewed Firstmate task.
- **Raw logs are not committed.** They are operator captures in the devcontainer's
  gitignored `/workspace/tmp`. Each is identified below by file name and SHA-256, so
  a retained copy can be verified.
- **Reviewed for secrets before citing.** Every capture was scanned for key, token,
  bearer, JWT, AWS-key and private-key shapes. The scan was positive-controlled
  against six synthetic credentials, all caught. Every credential-related word was
  read in context. The captures contain only names, paths, `[REDACTED]`
  placeholders and "credential-free" assertions — no credential values.
- **Python is history, TypeScript is the direction.** The September Python probes
  are kept as behavioural evidence for the TypeScript launcher's contracts. They
  are not the implementation direction.

Every run used `roe-coordination run --home /workspace/.firstmate-home --task <task>`
(a Firstmate reservation), image
`sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54` and Docker
Engine 29.4.0 (`daa0cb7f`, arm64), unless noted. "rc" is the exit code recorded in the
capture's `=== DONE rc=N ===` marker.

## Where the probe sources are preserved

| Lineage | Preserved at |
|---|---|
| Python `nono-*` probes, `checkpoint-container-probe`, `nono-provider-egress-probe` | [`recovery/2026-10-05-role-sandbox`](https://github.com/dr3dr3/dotai/tree/recovery/2026-10-05-role-sandbox) (recovery-only) |
| TypeScript `checkpoint-ts-container-probe`, `role-state-volume-probe`, `role-inert-launch-probe` | [`recovery/2026-10-05-checkpoint-ts`](https://github.com/dr3dr3/dotai/tree/recovery/2026-10-05-checkpoint-ts) (recovery-only) |
| TypeScript launcher and state engine (`406add9`, `cd7566e`), installed-startup fixture (`c542b29`) | [`feat/codex-provider-turn`](https://github.com/dr3dr3/dotai/tree/feat/codex-provider-turn) (draft #62) |

When a capture records a `runner_sha256` or `pins_sha256`, it was matched against the
preserved file and is noted as **pinned**. Otherwise the source is named from the
operator-request record, and the bytes that ran are not independently pinned.

## 1. Python sandbox probes (historical behavioural evidence)

Sources were untracked files in the shared dotai checkout at run time. The bytes
preserved on `recovery/2026-10-05-role-sandbox` may differ from those that ran.

| UTC start | Capture | rc | Purpose | Shows | Does not show |
|---|---|---|---|---|---|
| 09-28 08:08 | `ai-pilot-nono-probe-20260928080826.log` | 1 | Inert nono startup inside a container (task `nono-inert-probe`), baseline and `SYS_PTRACE` cases | Under Docker's default seccomp both cases fail; the reservation is retained on failure | Anything about roles or networking |
| 09-28 08:11 | `ai-pilot-nono-retry-20260928081111.log` | 1 | Retry of the same | The `SYS_PTRACE` case passes (restricted startup, output write, denied fixture access, child inheritance, environment filtering); the baseline still fails | That granting `SYS_PTRACE` is acceptable — the next run replaces it |
| 09-28 08:15 | `ai-pilot-nono-recover-20260928081538.log` | 0 | Reconcile the retained reservation by exact ID | Explicit reservation recovery works | — |
| 09-28 08:34 | `ai-pilot-nono-seccomp-20260928083426.log` | 0 | Compare seccomp profiles (task `nono-seccomp-comparison`) | Both controls reproduce `EPERM`; a **pidfd-only** seccomp profile lets nono start with every capability set at zero, and the exact containers are absent afterwards | Socket or network behaviour |
| 09-28 11:15 | `ai-pilot-nono-sockets-20260928111551.log` | 127 | Socket probe | Nothing ran: the operator command was truncated (`roe-: command not found`) | — |
| 09-28 11:16 | `ai-pilot-nono-sockets-20260928111633.log` | 0 | `nono-socket-probe/run.py` | Allowed connect, denied control-socket connect, own bind, denied sibling bind, child inheritance | Network filtering, a real Codex, restore (stated in the capture) |
| 09-28 12:08 | `ai-pilot-nono-network-20260928120812.log` | 0 | `nono-network-probe/run.py` | A CONNECT to an unlisted domain is denied with 403 | Provider inference, real role profiles, restore (stated) |
| 09-28 12:57 | `ai-pilot-nono-role-20260928125737.log` | 0 | `nono-role-probe/run.py` | A generated role profile: intended reads and writes, protected-state and sibling denials, child inheritance; the pinned native Codex runs `--version`/`--help` under it | An interactive agent, authentication, persistence or restore (stated) |
| 09-29 00:28 → 09-30 09:21 | `ai-pilot-nono-session-20260929002855.log`, `ai-pilot-nono-session-retry-20260929010025.log`, `ai-pilot-nono-session-20260929011028.log`, `ai-pilot-session-exit-evidence-20260929014008.log`, `ai-pilot-session-exit-retry-20260929025432.log`, `ai-pilot-nono-session-20260929052303.log`, `ai-pilot-session-recovery-20260929063032.log`, `ai-pilot-session-recovery-20260930092039.log`, `ai-pilot-session-recovery-20260930092111.log` | 1, 1, 1, 0, 1, 1, 126, 126, 0 | `nono-session-probe/run.py`: a local Codex app-server session, then its exit evidence and reservation recovery | Credential-free app-server initialisation and explicit thread identity pass; session-child protected and sibling denials pass. **Session acceptance fails**: the 05:23 run ends in `no persisted rollout: zero-turn persistence is unsupported or deferred`. The exit-evidence query was empty, which the capture itself notes is *not* proof that no event occurred. The two rc=126 runs were truncated commands; the final recovery found the reservation already clear | That a session persists or resumes |
| 10-03 03:34 | `roe-codex-persistence-3ac4b31a-20261003033414.log` | 1 | Codex persistence and resume under `nono-session-probe` | `thread/resume` fails with `no rollout found for thread id`: resume needs a persisted rollout, which a zero-turn session does not create | Persistence after a real turn |
| 10-01 06:00 | `ai-auth-file-subpath-preflight-f5f5a98c-20261001060005.log` | 1 | The historical 1 October synthetic auth-file preflight (Python) | It **never ran its fixture**: `roe-coordination` refused because the task's metadata was not registered | Anything about subpath mounts. Superseded by #66 ([brief](nono-one-turn-probe/PREFLIGHT-TASK-TS.md)); the Python source is retained by hash only |

## 2. TypeScript checkpoint, state and egress probes

| UTC start | Capture | rc | Source | Shows | Does not show |
|---|---|---|---|---|---|
| 10-03 10:01 | `roe-checkpoint-container-gate-6a9cbea1-20261003100104.log` | 0 | `checkpoint-container-probe/run.ts`, **pinned** (`dc20b250…`) | One synthetic checkpoint survives writer-container removal and reader-container creation; the exact volume is removed | Real Concierge state; restore across a host rebuild |
| 10-03 10:45 | `provider-egress-gate-992f0af2-20261003104504.log` | 0 | `nono-provider-egress-probe/run.ts` + `pins.json`, **pinned** (`86bc8288…`, `67688437…`) | A credential-free HTTPS endpoint check through the egress proxy; unlisted `example.org` denied with CONNECT 403; exact container removed | Authentication, inference, or any provider account |
| 10-03 11:20 | `checkpoint-ts-container-gate-66185e56-20261003112000.log` | 0 | `checkpoint-ts-container-probe/run.ts` + `pins.json`, **pinned** (`6decfd8e…`, `5e307113…`), `source_commit` `b3d9cf8` | The merged TypeScript checkpoint survives container recreation in one private volume, with no network, credentials, host bind or socket; volume removed | Real Concierge data |
| 10-03 11:36 | `role-state-volume-install-3779257d-20261003113607.log` | 0 | `role-state-volume-probe/run.ts` + `pins.json`, **pinned** (`04be56c9…`, `a008afa3…`) | Install stage: a labelled pilot fixture volume is written and sealed, retained for a separate verify request | Durability beyond the next request |
| 10-03 11:40 | `role-state-volume-verify-3249b9b9-20261003114041.log` | 0 | Same runner and pins, **pinned** | The checkpoint survives into a **separate reservation** and reloads in a fresh read-only container; exact volume removed afterwards | The real pilot state volume |
| 10-04 01:32 | `role-inert-launch-gate-df58e977-20261004013225.log` | 0 | `role-inert-launch-probe/run.ts` from the checkpoint-ts worktree (named by the operator request; bytes not pinned in the capture) | The inert TypeScript launch plan inside the nono boundary: intended reads and scoped writes; protected, sibling and child denials; filtered environment. Volume `roe-role-pilot-state-v1` created and then removed | A real role launch; any agent process |

## 3. TypeScript launcher chain (lineage of draft #62)

| UTC start | Capture | rc | Source (operator-request record) | Shows | Does not show |
|---|---|---|---|---|---|
| 10-04 02:04 | `role-state-prepare-gate-6c416c1e-20261004020449.log` | **1** | Committed launcher [`406add9`](https://github.com/dr3dr3/dotai/commit/406add9f92abe9a81d1e6d6e0a6655dd3c1feb00) | State is prepared and sealed, then the doctor fails with `find: '/state': Permission denied` (it listed the sealed root). **Fail-closed retention works**: the exact volume and the reservation are kept for reconciliation | A working doctor |
| 10-04 03:37 | `role-state-doctor-repair-17619164-20261004033758.log` | 0 | Repair [`cd7566e`](https://github.com/dr3dr3/dotai/commit/cd7566e2387b62629820eac3d4a574aa16a028b3) | `STATE_DOCTOR_OK` on the retained `roe-role-pilot-state-v1`, without listing its root; activation still disabled | Role launch |
| 10-04 09:42 | `codex-installed-startup-probe-b907b704-20261004094201.log` | 0 | Fixture [`c542b29`](https://github.com/dr3dr3/dotai/commit/c542b2931a315f54a054dc13eb4d9abe055e8077) | Native Codex 0.157.1 initialises with no credentials against a disposable clone of the installed state; sandbox denials hold; the installed volume is preserved; no provider calls | Authentication, a model turn, persistence after a turn |
| 10-04 22:41 | `codex-vercel-gateway-turn-dbe1e744-20261004224146.log` | **none** (no DONE marker) | `source_head` [`80d035d`](https://github.com/dr3dr3/dotai/commit/80d035dde8fee94096daa620aeb5682f91b08802) (draft #63) | Aborted with an input/output error at line 48 of the operator script, where it reads interactive input. The capture holds no turn output | Anything about the gateway or a provider turn. On its own it cannot show whether a provider request was attempted |

## Capture hashes (SHA-256)

```
92006a583460aac9abbce1fdd8838f78d5f42fa1a8fcfe1eb7fc4e1a274b9e0d  ai-auth-file-subpath-preflight-f5f5a98c-20261001060005.log
a090b79e4aea544c17b31ce59abf1ea8b87ccd7a36cd94701e78981227cdd38f  ai-pilot-nono-network-20260928120812.log
c3a5466c353bf667d8736e59433a121638a3da61245c34442d364790c2bc86b0  ai-pilot-nono-probe-20260928080826.log
f890becd6f1dada5661d93f7bfd40bae36c93544e76f94390b4c9c9732a7f0bb  ai-pilot-nono-recover-20260928081538.log
ccf4d2b96dd8819ce6297b57d48d521525c3789eadd91ee45fdcecc067a74f57  ai-pilot-nono-retry-20260928081111.log
7380807a72665754f356416cf33a4c270da7953eaabe3f8255b656a874e95fa2  ai-pilot-nono-role-20260928125737.log
366b8d31a5b9efecbe9cf5356e4dfb1da2eac8925ce0e3a4e941767b4d6c4c37  ai-pilot-nono-seccomp-20260928083426.log
846c996219943eadc0855aebfbc372f7692b4bbc914b81421a7721b286ffc9d4  ai-pilot-nono-session-20260929002855.log
4a39f0d48a3c614dc6d108e59c0087fa87d52d430b6a6a004a54c6af25428ac7  ai-pilot-nono-session-20260929011028.log
b4f1f1756b940a16c955ae77c23d8bf2f4a9144187e62865cfae00cef4a04e05  ai-pilot-nono-session-20260929052303.log
03bd26e9b12ed80816a30080515e28a560f614e0586a08dedc5e9efe99970832  ai-pilot-nono-session-retry-20260929010025.log
4912535e4eaa753084dd3487390bb06f826036cb49b89487fc23a358c0337dce  ai-pilot-nono-sockets-20260928111551.log
fe0a9e0b810d4ce7f39cf6af25e0309bb5bd994df267051e995b518d0354ef84  ai-pilot-nono-sockets-20260928111633.log
79e311940f500f596f3823a5ca5b096c3562847d50d397e8779a30846ca3b5fa  ai-pilot-session-exit-evidence-20260929014008.log
b98b94c6b04c10a71debad48d480fa04dae945c8fa3d7db51afffaf727aeeb83  ai-pilot-session-exit-retry-20260929025432.log
532773c186be70e913992991f7a3956145abadd62b8fab126539181989744218  ai-pilot-session-recovery-20260929063032.log
fafb5f991ac65470719ffad9a74812011b798a9ba1a702dab993d9de69d0ee01  ai-pilot-session-recovery-20260930092039.log
2a2ed83deb9e56367276e9988ba1aa639454a7c32598a85b7db949436c8c9744  ai-pilot-session-recovery-20260930092111.log
f7707f5f6560439cb0dff8faf1d5a56e31ce5d5120ba66edcfb188993c42ebde  checkpoint-ts-container-gate-66185e56-20261003112000.log
5af0977728e2450708038a71e704d3d4da4152d8188ff95fc53fae6621ded41e  codex-installed-startup-probe-b907b704-20261004094201.log
24af69b6755f460ceebb5a38d8eaebb5251ba5264c1adfeeeb52cb0ca62ff97a  codex-vercel-gateway-turn-dbe1e744-20261004224146.log
b65356aa4284377fb8998c68e006d4e59932529928b059070f2ac6d0cd9444f4  provider-egress-gate-992f0af2-20261003104504.log
55fcd3993a46fde5e4d7afe9be6159d161fa263ec1effcad55d87bdb19c1f6da  roe-checkpoint-container-gate-6a9cbea1-20261003100104.log
5e95f687f58973ff74d67d50bc3b681a37a811591cb9845c7c551b86ad4eb130  roe-codex-persistence-3ac4b31a-20261003033414.log
db05b75192b92b4b3979b04075783ac7b7af609d5bd50938a449ecf67608c6be  role-inert-launch-gate-df58e977-20261004013225.log
f7897b8f724f80081e6efc99ae79e15f864cb7d928507f480b7bb32529bd331c  role-state-doctor-repair-17619164-20261004033758.log
871169c13015769c0c92ee5af8a27ce2f521a2a80b505d5a9919abb4b77345d0  role-state-prepare-gate-6c416c1e-20261004020449.log
446a6bdc826cb00254b7f9c1e43b5905b21611b5b9a87a190bd51c9ced8c2814  role-state-volume-install-3779257d-20261003113607.log
10125b2616c78e5ebdfedec03e78922a0dd62b6a8f2477f50088640e5b9ad269  role-state-volume-verify-3249b9b9-20261003114041.log
```

Excluded from this index: the local offline test and bundle logs (no exit marker,
not operator captures), `ai-pilot-attach-20260928071612.log` (a raw Herdr terminal
attach, not a probe), and unrelated platform probes.

## What remains unproven

- A real authenticated role session; any model turn (the one-turn provider probe is
  separately gated and spend-limited).
- Persistence and resume after a turn.
- Restore across a devcontainer rebuild.
- Launcher acceptance of `run`, which stays disabled until role context and
  `--resume` binding are ported to TypeScript.

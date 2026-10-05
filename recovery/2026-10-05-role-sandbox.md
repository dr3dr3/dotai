# Recovery provenance — `recovery/2026-10-05-role-sandbox`

**Recovery-only. Not for merge. Must be split and reviewed before any PR.**
Copied by the `init-ai-setup` coordination session under André's 2026-10-05
preservation authorization. `init-ai-setup` did **not** author this content.

- Source checkout: `/workspace/.ai/dotai` (shared), branch `main`, HEAD
  `cd99829e30c518160a78819680f8f358b7da9fb1`, dirty (126 status entries). All files
  here were **untracked** in the source. Source was read only.
- Clean base: `origin/main` `79b903aaeb28db6a71f3c4a04f1b699bd35e2bc3`.
- Originating session: the original role/sandbox session (not identifiable from Git).
  Source mtimes 2026-09-27 → 2026-10-03.
- Commits: one for the Python role generator + catalogue, then one per probe family.

## Files (SHA-256 of source == committed bytes)

```
d225e7c3da85fc4a5915dd6830e79b5d7e593c858f9b7a6e3962c21845a60bbd  roles/README.md  (source: /workspace/.ai/dotai/roles/README.md, mode 644)
a2ee6fe05113147028da6d67e9c5b0df4534b1b67f7082dba354d5ff9d2fbd54  roles/catalogue.json  (source: /workspace/.ai/dotai/roles/catalogue.json, mode 644)
f8050709119d8fdd5ec3625dc948a13edb07e015d2e6f471556db1513e2c65e5  roles/codex-runtime.json  (source: /workspace/.ai/dotai/roles/codex-runtime.json, mode 644)
57432761c174ba25b763095e907a6e80a8f9b3a88c8a07766bb6cc42f8a22af2  scripts/roe-role  (source: /workspace/.ai/dotai/scripts/roe-role, mode 755)
8ee9d92493068188913c26e64517e5ab2f07b5ad19ba10c868e7cb30f6ce1330  scripts/roe_role_harnesses.py  (source: /workspace/.ai/dotai/scripts/roe_role_harnesses.py, mode 644)
253b4e5df4ce253768e7132a44fd18c8e8b7ba1a078a4b03b0622d8b5bdf5181  tests/test_roe_roles.py  (source: /workspace/.ai/dotai/tests/test_roe_roles.py, mode 644)
9ca0f0b53a0f9c9a9e95703149a352f3b8be6d66c86e9999bd873db9a22433e2  roles/checkpoint-container-probe/README.md  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/README.md, mode 644)
edbd6f5c0ac7c22f84bd02144d538b6559bea8e544cdd2f3466da97857fcf80f  roles/checkpoint-container-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/TASK-BRIEF.md, mode 644)
e460e6414dcc8d1cdef56b5df63ec41e47f77fd6afbb2f31673224a302ab7bde  roles/checkpoint-container-probe/pins.json  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/pins.json, mode 644)
ba19684ecdb1435367d56cc9d70412cb5ebd55ede86fd2ee6c3bbbe98f8f1911  roles/checkpoint-container-probe/reader.sh  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/reader.sh, mode 644)
dc20b2503b7a0e4122fbaab878771ac9fb3a76f5660e958bd915accd95458816  roles/checkpoint-container-probe/run.ts  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/run.ts, mode 644)
05aff0368e92907a233400b536c22ee4a0fd9848f0078af22591c876d1525e4f  roles/checkpoint-container-probe/test_run.ts  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/test_run.ts, mode 644)
cd759227fcb9cc29123255ed47f6d4ad476f408163060fae2d981e8bb10aacbf  roles/checkpoint-container-probe/writer.sh  (source: /workspace/.ai/dotai/roles/checkpoint-container-probe/writer.sh, mode 644)
606246286a502b2d5db3bc956980e5c9e2bbc579afdb264eede44fee63ecbed6  roles/checkpoint-probe/README.md  (source: /workspace/.ai/dotai/roles/checkpoint-probe/README.md, mode 644)
84f6bf4e50d0fa0dd4f6adf69215f32e47c6211e47083120edf9e6d36b603900  roles/checkpoint-probe/checkpoint-probe.ts  (source: /workspace/.ai/dotai/roles/checkpoint-probe/checkpoint-probe.ts, mode 644)
881a8d90678b325811f0b5124d0ba038f84cf1a3756fbfa0ae9e931323cdbe70  roles/nono-network-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-network-probe/README.md, mode 644)
259b8154173583d4ade7d37cbc0d937c33b9afd2e11ceab81989a287ed1772b5  roles/nono-network-probe/bundle.json  (source: /workspace/.ai/dotai/roles/nono-network-probe/bundle.json, mode 644)
64511b3bbf9b661b78da360ba9049b9e6bea83d88f1f496fa31e90c1d2996b85  roles/nono-network-probe/check.sh  (source: /workspace/.ai/dotai/roles/nono-network-probe/check.sh, mode 644)
e11f333a0ee1dd7aa757f1da3c0cda5a1e9dca1fd79f3ee64d2085604adf2261  roles/nono-network-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-network-probe/entry.sh, mode 644)
edf0c2a64f429e8bb2c541ce4d890fcbaf45d032b5b25112922afe7f34d2286c  roles/nono-network-probe/network-probe.c  (source: /workspace/.ai/dotai/roles/nono-network-probe/network-probe.c, mode 644)
cc76179ec57162a685500bf727b0e90f0c96ef680daddb1fd5610ce7f16ddb45  roles/nono-network-probe/pins.json  (source: /workspace/.ai/dotai/roles/nono-network-probe/pins.json, mode 644)
39423002f3cb1320308b7dba55fe67347690256543761ae7e882caed593c2fa4  roles/nono-network-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-network-probe/profile.json, mode 644)
70842a26c117fc2175a0e60b7bc6a33755e0bf5fbc32768b286bd6d372040993  roles/nono-network-probe/run.py  (source: /workspace/.ai/dotai/roles/nono-network-probe/run.py, mode 644)
17f936ced37fa4f8f29adeeaa83cfe0bf1c44e026458082921e5139d9a66367a  roles/nono-one-turn-probe/REVIEW.md  (source: /workspace/.ai/dotai/roles/nono-one-turn-probe/REVIEW.md, mode 644)
05972370c75a66be58a026503f844975dcd16632a5ccc90608c22b30d95d804a  roles/nono-one-turn-probe/protocol.py  (source: /workspace/.ai/dotai/roles/nono-one-turn-probe/protocol.py, mode 644)
c8aaf1b55010099a68987db2c7502c33bdc373c7b364bc5a4d4a104334c20510  roles/nono-one-turn-probe/test_protocol.py  (source: /workspace/.ai/dotai/roles/nono-one-turn-probe/test_protocol.py, mode 644)
9125de80d78cb685b782ddff0663455897be84a5695c2368df9ae6ec5c7dde37  roles/nono-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-probe/README.md, mode 644)
4eb1ab313529eb8597aa676af053630b2b505cf54d12f652a8d8e783accdabab  roles/nono-probe/check.sh  (source: /workspace/.ai/dotai/roles/nono-probe/check.sh, mode 644)
c57314d5288001e3cf5ec459e3bea1466bcc0031bf39819e52a595e0c978f5b5  roles/nono-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-probe/entry.sh, mode 644)
6550310fd77ceb85b7ba7038940a294cb66afaabfe7e0e71995ae49b02f31db8  roles/nono-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-probe/profile.json, mode 644)
0dd2e884293cd777bd46da7f38504d49f1425d903c9379fb29b57bb127cd401a  roles/nono-probe/run.py  (source: /workspace/.ai/dotai/roles/nono-probe/run.py, mode 644)
52ac2cc3d4a9fe300c969f212e382ec3e256e587bb4ba113e8c1ea5815a5c184  roles/nono-provider-egress-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/README.md, mode 644)
5f81f7121862368b7ab65392c833547eb91cbc253b4943d8295fdfd4a0318a57  roles/nono-provider-egress-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/TASK-BRIEF.md, mode 644)
52fd6eeb5ac578d3c1d34d097a42d64759a6aadfc73aac31363123943e560f48  roles/nono-provider-egress-probe/check.sh  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/check.sh, mode 644)
e11f333a0ee1dd7aa757f1da3c0cda5a1e9dca1fd79f3ee64d2085604adf2261  roles/nono-provider-egress-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/entry.sh, mode 644)
6768843728e72679c0797355ba9c7016843b367ae3c920b2112da88b44fd87ab  roles/nono-provider-egress-probe/pins.json  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/pins.json, mode 644)
63e7533b0e02ac548814f7fa3674820ee209c8b064c2c6ee136b78a5d12bf678  roles/nono-provider-egress-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/profile.json, mode 644)
86bc82885a6fa0b5f94a3525b0dfea4a7cf302498e32e15aad3245396ff41ada  roles/nono-provider-egress-probe/run.ts  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/run.ts, mode 644)
26dc0f128decf86327315c25272b4ccc9c7c8fefcd07eed307b0453819414049  roles/nono-provider-egress-probe/test_run.ts  (source: /workspace/.ai/dotai/roles/nono-provider-egress-probe/test_run.ts, mode 644)
66cbab822555d563c5142e5d05e063b57e80d6cc68cc10e2bf0fe4909400c415  roles/nono-role-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-role-probe/README.md, mode 644)
e274c2c5320f1bd6836b6444c452152616fe7f93fe984ac9732123c4430ed28d  roles/nono-role-probe/check.sh  (source: /workspace/.ai/dotai/roles/nono-role-probe/check.sh, mode 644)
74ec8ebcf98c25bcc9431d624dc3d2756910f28c35e6a3e5d0115498e139f158  roles/nono-role-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-role-probe/entry.sh, mode 644)
f17e56e57d698c154e85784643570f5c1b43c9c65d6922aafa006d79951a94f6  roles/nono-role-probe/pins.json  (source: /workspace/.ai/dotai/roles/nono-role-probe/pins.json, mode 644)
ca5fc91ca4142a1fd425f59cb5bde641ce8d0980c55530308b3432e327ba8baf  roles/nono-role-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-role-probe/profile.json, mode 644)
d6742c9326a46957bd965cd47bf9ce34070d8e0d525ae0b5cdaaf107e2d3f344  roles/nono-role-probe/run.py  (source: /workspace/.ai/dotai/roles/nono-role-probe/run.py, mode 644)
4a04112982032e76df9ec7c20c90581a816b84184df96237fe24c8a1dc7f6264  roles/nono-session-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-session-probe/README.md, mode 644)
c1885d8e7ef4db0747202202658a590260983634cd6af8b67296bb3eb5ae0e3b  roles/nono-session-probe/check.sh  (source: /workspace/.ai/dotai/roles/nono-session-probe/check.sh, mode 644)
8bfe40ec9d7d1f5d5f08483c10f62abba1f3a0d7236dd090fc502522234d0791  roles/nono-session-probe/client.py  (source: /workspace/.ai/dotai/roles/nono-session-probe/client.py, mode 644)
615d803d1efdaa67a8fee88d2837ba0dcbe4a960e29ac498836c8d20d493b443  roles/nono-session-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-session-probe/entry.sh, mode 644)
115021105361509461848510422cc5ed5078d331730e5dcc4ab668ea8e0950af  roles/nono-session-probe/pins.json  (source: /workspace/.ai/dotai/roles/nono-session-probe/pins.json, mode 644)
581e9db4df119396aa3f056a11e79509c722c5a22acc533a12d7be067b461488  roles/nono-session-probe/prepare.py  (source: /workspace/.ai/dotai/roles/nono-session-probe/prepare.py, mode 644)
35812821eed3873371e88b8e6e54ae1737eaa4376b1c77c36984d81216cf9a17  roles/nono-session-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-session-probe/profile.json, mode 644)
a9e495e71ed4aead4962097fd420a7b40467c672909d6d816f02bba24470c227  roles/nono-session-probe/protocol-evidence.json  (source: /workspace/.ai/dotai/roles/nono-session-probe/protocol-evidence.json, mode 644)
52d8aeea2b1fdeb16ef034176ff1d57e15f739b3418a40ab1e66a990208c6694  roles/nono-session-probe/run.py  (source: /workspace/.ai/dotai/roles/nono-session-probe/run.py, mode 644)
04d3807e856f068d2ab5491a11e365aa1a30ec5d6b878d2e03c4576f44c895a0  roles/nono-session-probe/test_client.py  (source: /workspace/.ai/dotai/roles/nono-session-probe/test_client.py, mode 644)
b20fd92e351352c98e48dd2753947115f9500eb8f4d332e1f35fac096dec17a5  roles/nono-session-probe/test_runner.py  (source: /workspace/.ai/dotai/roles/nono-session-probe/test_runner.py, mode 644)
af259df64dec6edd307b5ce508af9da18fee9ef9ef614e2154aa31b475ac0100  roles/nono-socket-probe/README.md  (source: /workspace/.ai/dotai/roles/nono-socket-probe/README.md, mode 644)
13894a201e2de754dae7639808862c8600de305fac9edf08dbd916edd86e409a  roles/nono-socket-probe/entry.sh  (source: /workspace/.ai/dotai/roles/nono-socket-probe/entry.sh, mode 644)
27697465c1d116716b6a218da78743b53de727d3181a06b72affc6be47308564  roles/nono-socket-probe/pins.json  (source: /workspace/.ai/dotai/roles/nono-socket-probe/pins.json, mode 644)
90db9b6d14c1847c6f468b0bee5835d186813b664c34e9ada42c83319fcaa8dc  roles/nono-socket-probe/profile.json  (source: /workspace/.ai/dotai/roles/nono-socket-probe/profile.json, mode 644)
543964b05bb17ebc1ad622c110ae9409feb6eb27103a01a409ffe1567c700178  roles/nono-socket-probe/run.py  (source: /workspace/.ai/dotai/roles/nono-socket-probe/run.py, mode 644)
1878d6c9df05df20a1e75d85ad13b7b17dcb2eb0941e08a1ebd093e00c598a86  roles/nono-socket-probe/socket-probe.c  (source: /workspace/.ai/dotai/roles/nono-socket-probe/socket-probe.c, mode 644)
```

`roles/catalogue.json` and `roles/codex-runtime.json` are byte-identical to the copies
on `origin/feat/codex-provider-turn`; included so this snapshot is self-contained.

## Hash-only (deliberately NOT committed — André decision 1)

The 1 October synthetic auth-file preflight is historical and must not return to
`main` or become runnable. PR #66 supersedes it. Bytes left untouched in the source:

```
d60884e38d43afb2e7196bd917f22a144b2195701d3d4c75330d9ce1ad56596e  roles/nono-one-turn-probe/PREFLIGHT-TASK-TS.md
cc21c3f3bda68ae40172516fb904ceb12a9c7321fa78dfca806f5779ed1e5dda  roles/nono-one-turn-probe/PREFLIGHT-TASK.md
6c59f9a4cc7225a64dc86ac51fa00778a8b60b885e177827215bbf01c528d795  roles/nono-one-turn-probe/test_volume_preflight.py
8789567710367cf44b7dfc84d004c34fff63948788e940e6cb58fd38d4b35a97  roles/nono-one-turn-probe/test_volume_preflight.ts
61e35c577de8486a914624fcf3984f51ca8750c1e44388ecb8c9c0abb68d97b4  roles/nono-one-turn-probe/volume_preflight.py
79e8c35003343bc43824a60b16fbe228f95175c460af25505ed760d37b223861  roles/nono-one-turn-probe/volume_preflight.ts
```

`volume_preflight.py` matches the "Reviewed SHA-256" recorded inside its own
`PREFLIGHT-TASK.md`. The two `.ts` files and `PREFLIGHT-TASK-TS.md` are the 1 October
TypeScript drafts of the same request, superseded by PR #66 (host Codex captain).

## Language direction

André's direction (2026-10-05): TypeScript, not Python, for our code. This reverses
decision 2 of the preservation authorization (Python generator as pilot baseline).
The Python generator and Python probes are preserved here for history and a
parity/port review only — this branch does not make them canonical.

## Exclusions

Firstmate edits → `recovery/2026-10-05-firstmate-repair`; checkpoint-ts worktree and
TypeScript role-prepare briefs → `recovery/2026-10-05-checkpoint-ts`; Concierge files,
`docs/remote-herdr-and-cloud-app-stacks.md`, `CLAUDE.md`, `.claude/skills` → not preserved
here (see coordinator report).

## Unresolved ambiguity

- Shared `roe-firstmate-claude-captain.json` grants read of `roles/nono-probe/*` — coupled
  to this branch.
- Python vs TypeScript generator: resolve via the parity/migration review.

## Offline validation

Passed: `tests/test_roe_roles.py` (14), `nono-one-turn-probe/test_protocol.py` (5),
`nono-session-probe/test_client.py` (4); JSON parse of every `roles/**/*.json`;
`bash -n` on every probe shell script; Python AST parse of every probe `.py`.
**Not run:** `nono-session-probe/test_runner.py` (mocks `docker run`; a mock leak would hit
Docker), and every `test_run.ts` / probe runner (container/runtime adjacent).

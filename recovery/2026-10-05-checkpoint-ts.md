# Recovery provenance — `recovery/2026-10-05-checkpoint-ts`

**Recovery-only. Not for merge. Must be split and reviewed before any PR.**
Copied by the `init-ai-setup` coordination session under André's 2026-10-05
preservation authorization. `init-ai-setup` did **not** author this content.

- Clean base: `origin/main` `79b903aaeb28db6a71f3c4a04f1b699bd35e2bc3`.
- Originating session: the original role/sandbox session (not identifiable from Git).
- Source 1: worktree `/workspace/.ai/dotai-checkpoint-ts-acceptance`, branch
  `feat/checkpoint-ts-acceptance` @ `b3d9cf811b9770e9fde03a50b9ec1a888a6c4142` (an
  ancestor of `origin/main`), 26 untracked files, no tracked modifications. Mtimes 2026-10-03.
- Source 2: `roles/role-state-doctor-repair/TASK-BRIEF.md`, uncommitted in
  `/workspace/.ai/dotai-role-prepare-repair` (`feat/role-prepare-doctor-repair` @ `cd7566e`).
- Source 3: `roles/role-prepare-doctor-probe/TASK-BRIEF.md`, uncommitted in
  `/workspace/.ai/dotai-role-prepare-acceptance` (`feat/role-prepare-doctor-acceptance` @ `406add9`).
- The committed work of both role-prepare branches (`406add9`, `cd7566e`) is already on
  `origin/feat/codex-provider-turn`; only the briefs were at risk.

## Files (SHA-256 of source == committed bytes)

```
a2ee6fe05113147028da6d67e9c5b0df4534b1b67f7082dba354d5ff9d2fbd54  roles/catalogue.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/catalogue.json, mode 644)
01ab0ff5ec52e8820049b45eb2d46f511fbf6f40bd4a84892d188c961043ae2a  roles/checkpoint-ts-container-probe/README.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/README.md, mode 644)
2c03e71a34daa93b1d96fcfa6bf13b64f43e8ca3095b35d8c056d631850ade9d  roles/checkpoint-ts-container-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/TASK-BRIEF.md, mode 644)
d5faba0ffa61a6ce4731b79a53b56eb1431cd2a008a14a773ab3ec89f5f3d142  roles/checkpoint-ts-container-probe/bundle.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/bundle.json, mode 644)
5e307113b2ef1a3c6e1a694ddf86ac6b99a01802cc2cddf5b8ea9ae7124bb1e1  roles/checkpoint-ts-container-probe/pins.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/pins.json, mode 644)
a4c25626a3bd79ff7e6f02c5f26bcf112d85ce6f2c79831d9049e0c61cef2615  roles/checkpoint-ts-container-probe/reader.sh  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/reader.sh, mode 644)
6decfd8e2542bce03ef118963ed418f4f63d6df08c6bc9aff9428fbbb62a07b2  roles/checkpoint-ts-container-probe/run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/run.ts, mode 644)
454e9423b97eb42bfa508897480b7f8e388f3d8f853913362eec24725107862e  roles/checkpoint-ts-container-probe/test_run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/test_run.ts, mode 644)
37d5211fc0a99eaf05dc29ba0ac414459b0fadd64cbc12b12863e7674740ff18  roles/checkpoint-ts-container-probe/writer.sh  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/writer.sh, mode 644)
f8050709119d8fdd5ec3625dc948a13edb07e015d2e6f471556db1513e2c65e5  roles/codex-runtime.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/codex-runtime.json, mode 644)
16801bf5920f9b493179d8e781a831addfc3029cf82cd2dab2e43108bcb9fa01  roles/role-inert-launch-probe/README.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/README.md, mode 644)
37d149fec020c054357b83867afbc0423ddd115b263f21c732fccf38b4129378  roles/role-inert-launch-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/TASK-BRIEF.md, mode 644)
0b2feb48a697d415bf079889261123021b4fde691de42792a195bfc020ddf872  roles/role-inert-launch-probe/check.sh  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/check.sh, mode 644)
75a2ef2a44e739f15894c273b485f1065bfd14028a95e649c00f5e526295d8ed  roles/role-inert-launch-probe/entry.sh  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/entry.sh, mode 644)
6accf76c0f443cc8cf38156a1900120d0ae255f4a5d18a618225c5ed6fefca0c  roles/role-inert-launch-probe/pins.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/pins.json, mode 644)
19771973ff7ccc3fe0790b6e9e29ddddb93475e1f040dba7722babf54472edd8  roles/role-inert-launch-probe/run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/run.ts, mode 644)
3d6b2ccf9612cfb0ef411b4736f4a264be625e811dbf1db30fa884665f4d9450  roles/role-inert-launch-probe/test_run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/test_run.ts, mode 644)
56ab50da9f9c42b419029936b3bf9d4edd1b0c2f9e22111f34c42ef88ae4d608  roles/role-state-volume-probe/README.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/README.md, mode 644)
4b0042d91e0002eb0e9dbb96f6ee0ff20b60bc28c0a11113f5e0c6c3cfb2bfb9  roles/role-state-volume-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/TASK-BRIEF.md, mode 644)
a008afa3c7b4cfb2566e881eb0a7338f27e7751ad99323f0e4047c40711b04d4  roles/role-state-volume-probe/pins.json  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/pins.json, mode 644)
04be56c93d2d758a4ac1320c340be967d19fe88cb09a060eafff42d764cc1d61  roles/role-state-volume-probe/run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/run.ts, mode 644)
31f322efdb94a31f9a176c0c46fcd0f7ff78386834354a99dd2c03f78c1bf41e  roles/role-state-volume-probe/test_run.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/test_run.ts, mode 644)
905575e7240f0227f8141cef9676fbb1fe3af35d1d14659192348b50a9ad675c  scripts/roe-role-ts-README.md  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/scripts/roe-role-ts-README.md, mode 644)
a31e843668f0f23a14c1bcdac66f06a8d8c7e6bb62aa3454ef3a5c899d06cb92  scripts/roe-role.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/scripts/roe-role.ts, mode 644)
919ace9222599d2c680901a15ec87c753347a87c7f9018b963457f4648f5b0b5  skills/wip-tracker/tests/checkpoint_process.test.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/skills/wip-tracker/tests/checkpoint_process.test.ts, mode 644)
5706d053ebc840b19acccbbaa16a31f8c8c8e72caf2b3eec1d7aa9a78544b9b0  tests/roe_role_ts.test.ts  (source: /workspace/.ai/dotai-checkpoint-ts-acceptance/tests/roe_role_ts.test.ts, mode 644)
2f29ccb911006cc7eb9a409b338392e82c75700fd7bff1f9f894afc4b6ecd8ac  roles/role-state-doctor-repair/TASK-BRIEF.md  (source: /workspace/.ai/dotai-role-prepare-repair/roles/role-state-doctor-repair/TASK-BRIEF.md, mode 644)
377be66534eea75f2fb03fed89b82aca252533a5520b10a43df3fb8ad66ecab7  roles/role-prepare-doctor-probe/TASK-BRIEF.md  (source: /workspace/.ai/dotai-role-prepare-acceptance/roles/role-prepare-doctor-probe/TASK-BRIEF.md, mode 644)
```

## Notes

- `scripts/roe-role.ts`, `scripts/roe-role-ts-README.md` and `tests/roe_role_ts.test.ts`
  **differ** from the same paths on `origin/feat/codex-provider-turn`. Two TypeScript
  launcher lineages exist; reconcile before any PR.
- `roles/catalogue.json` and `roles/codex-runtime.json` are byte-identical to the shared
  checkout copies (also on `recovery/2026-10-05-role-sandbox`).
- The two briefs are Firstmate registration *requests*. Preserving them registers nothing.
- Language direction (André, 2026-10-05): TypeScript is the target for our code. That
  reverses authorization decision 2. This branch is still recovery-only and makes nothing
  canonical; the parity/migration review decides.

## Offline validation

Passed: `node --test tests/roe_role_ts.test.ts` (6), `node --test
skills/wip-tracker/tests/checkpoint_process.test.ts` (1), both on temporary directories.
**Not run:** the three probe `test_run.ts` files (they import `runContainer`/`main`,
next to code that launches containers).

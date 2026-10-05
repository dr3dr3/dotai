# TypeScript role launcher candidate

This is a plan-only, fail-closed candidate in the isolated
`dotai-checkpoint-ts-acceptance` worktree. It is not installed as the `roe-role`
command and does not replace the older Python launcher yet. It creates no
volume, directory, credential link, container or agent process.

`node scripts/roe-role.ts plan-state pilot --harness codex` validates the
reviewed native Codex ELF and SHA-256 pin, then prints the proposed private
`roe-role-pilot-state-v1` volume, `/state/pilot` paths and UID 1000 mapping.
The `inertProfile()` source now derives a credential-free nono boundary from
that mapping. It grants only selected role subdirectories, synthetic context
and an inert instruction file. It grants no auth file or provider endpoint.
The catalogue and pin were copied from the current personal dotai source with
their hashes preserved; the executable is not silently re-pinned.

`list`, `harnesses` and `inspect` are read-only. `prepare`, `doctor`, `run` and
`--resume` refuse before state changes. Explicit harness selection is required;
Claude and Pi remain independent unverified adapters and cannot fall back to
Codex. The permanent volume name is a proposal only. The completed synthetic
fixtures used separate test-only volumes and did not install this proposal.

The separate `roles/role-inert-launch-probe/` runner pins this source and
tests that boundary in a disposable container through Firstmate. A passing
probe remains fixture evidence; it does not install this candidate.

Next source gates: integrate an installed trusted TypeScript operator path,
then separately prove
provider authentication/inference, exact native transcript resume and Herdr
restart/restore before enabling any role. Claude and Pi require their own
adapter-specific gates.

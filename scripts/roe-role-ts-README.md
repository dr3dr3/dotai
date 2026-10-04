# TypeScript role launcher candidate: private-state preparation

This isolated candidate can prepare and inspect the exact private Pilot state
volume under a registered Firstmate reservation. It is not installed as the
`roe-role` command. The older Python launcher remains disabled. `run` and
`--resume` still refuse, and Claude and Pi remain independently unverified.

`node scripts/roe-role.ts plan-state pilot --harness codex` is read-only and
verifies the reviewed native Codex ELF/SHA-256 pin. `prepare` verifies the
same pin, the accepted nono profile digest and pidfd-only seccomp policy; it
then creates only `roe-role-pilot-state-v1` if absent. The trusted operation
sets up `/state/pilot` as UID 1000 with `0700` directories, a `0400` contract
and inert instruction file, seals the volume root to `0711`, and runs a
read-only doctor check. If the exact labeled local volume already exists,
`prepare` only runs that doctor check and refuses incompatible or partial
state. `doctor` never creates a volume and verifies metadata, paths, modes,
contract digest, that the sealed volume root cannot be listed by UID 1000,
and that the role home contains no files or symlinks.

The Docker calls use the pinned image with one named volume mount, no host
bind, no network, read-only image root, all capabilities dropped, no new
privileges, the reviewed seccomp policy, and exact container IDs for cleanup.
The containers are trusted maintenance shells, not Codex or a role process.
No credentials or model calls are used. Successful preparation intentionally
leaves the private volume installed; a failure retains it and the Firstmate
reservation for explicit reconciliation. The volume must not be force-removed
or silently reused.

The separate `roles/role-prepare-doctor-probe/` runner freezes the source and
pins for two captain-operated requests: `--prepare`, then `--doctor` in a new
reservation. Passing both would prove the installed private-state mapping,
not provider authentication/inference, native transcript resume or Herdr
restore. Activation remains disabled until those separate gates pass.

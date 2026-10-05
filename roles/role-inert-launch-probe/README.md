# Inert TypeScript launcher boundary fixture

This fixture binds the TypeScript `roe-role.ts` `pilot` state plan to its
generated credential-free nono profile. It never starts Codex, Claude, Pi,
Herdr or any model call. The native Codex executable is checked on the host
against its existing exact ELF/SHA-256 pin, without re-pinning or streaming
it into the container. No Python code or interpreter is included.

`node run.ts` checks source pins and prints the exact plan without Docker.
`node run.ts --bundle-check` additionally validates the deterministic bundle;
the generated nono profile was validated offline with nono 0.76.0. The live
mode, `--execute`, requires a Firstmate reservation token and the registered
operator task. No direct Docker command is authorised by this README.

The live plan refuses any pre-existing `roe-role-pilot-state-v1` volume. It
creates that exact volume with role/purpose/contract labels and no driver
options, uses one bounded root container to set the volume-root mode, then
runs an inert UID 1000 shell under the generated nono profile. Its only mount
is that volume at `/state`; `/tmp` is a disposable tmpfs. The image root is
read-only, network is none, all capabilities are dropped, no new privileges
are allowed and the reviewed pidfd-only seccomp policy applies. No host HOME,
workspace, credential, Docker or Herdr socket is mounted.

Pass requires intended synthetic reads and role-subdirectory writes,
protected-state/sibling read denials, HOME/context write denials, exec-child
inheritance, environment filtering, all five zero capability sets,
`NoNewPrivs=1`, `Seccomp=2`, stopped container IDs, their exact removal,
and exact volume removal/absence. On uncertain failure, the runner stops and
retains the exact volume and Firstmate reservation for human reconciliation.
It does not broaden grants, force-remove an unknown container or retry.

This would prove only an **inert fixture under the proposed TypeScript state
mapping and generated profile**. It would not prove an installed launcher,
provider authentication/inference, Codex native transcript resume or safe
Herdr restore. Role activation remains disabled; Claude and Pi remain
unverified and refuse launch.

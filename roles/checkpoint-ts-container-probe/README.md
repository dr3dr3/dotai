# Merged TypeScript checkpoint across container recreation

Prepared on 2026-10-03 from dotai commit
`b3d9cf811b9770e9fde03a50b9ec1a888a6c4142`. The prior checkpoint
container result exercised Python `continuity.py`; this fixture runs the merged
TypeScript `Store` and CLI. No Python code or interpreter is bundled or invoked.

Default `node run.ts` verifies exact input hashes and prints a plan; it makes no
Docker call. `node run.ts --bundle-check` also runs the pinned Node 22.23.2
binary and merged TypeScript CLI against synthetic events in a private local
store, then builds a deterministic payload. It makes no Docker call.

The proposed live gate uses one unique synthetic named volume at `/state`.
Four disposable, network-none containers initialize the volume, write the
checkpoint as UID 1000 in `/state/pilot` mode `0700`, seal the volume root,
then read the exact checkpoint from a fresh UID 1000 container with the volume
mounted read-only. The SQLite file must be mode `0600`. The runner verifies
exact thread/checkpoint/session IDs, content and revisions, null provider
identity, unchanged runtime authority, distinct container IDs and exact
cleanup. The volume is removed only after full success.

The payload is streamed through stdin. No host HOME, workspace, credential,
Docker or Herdr socket is mounted. No role, network, model call or application
service starts. The worktree is a source location for the trusted operator;
none of its paths becomes a container mount. The role activation flag remains
disabled, and Claude/Pi adapter status is unchanged.

Any changed hash, commit, bundle or engine refuses execution. A timeout,
unknown container state or failed acceptance retains the exact synthetic
volume and the Firstmate reservation for human reconciliation. There is no
automatic retry, grant expansion or broad cleanup. Passing will establish
only synthetic TypeScript semantic checkpoint persistence across disposable
container recreation. It will not establish provider transcript resume,
authentication/inference, installed role state or Herdr restoration.

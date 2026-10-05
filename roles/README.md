# Personal advisory roles — implementation preview

Status: prepared source; activation disabled, 2026-09-28.

The catalogue maps stable role IDs to titles, purposes and Herdr locations. The
canonical charters remain in ai-context. This is a personal opt-in prototype;
no shared setup script installs it and no background agents are started.

## Inspect and check

Run the source launcher directly:

```sh
/workspace/.ai/dotai/scripts/roe-role list
/workspace/.ai/dotai/scripts/roe-role harnesses
/workspace/.ai/dotai/scripts/roe-role inspect baxter --harness codex
/workspace/.ai/dotai/scripts/roe-role prepare baxter
/workspace/.ai/dotai/scripts/roe-role doctor baxter
```

`prepare` writes generated instructions, profile and private Codex configuration
under `~/.local/state/roe-roles/ROLE`, and creates an absent checkpoint in
`ai-context/plans/active/macbook-pilot-records/ROLE`. It does not start an agent.
Preparation, doctor and launch take the same per-role lock; a busy role refuses
preparation before files are rewritten. Live reconfiguration is not implemented. The auth link points to the existing personal Codex auth file;
credentials are not copied. The intended nono profile makes that source read-only,
so token refresh may fail and must be handled outside the role session.

`doctor` attempts real nono execution with inert filesystem, environment and Unix
socket probes. A passing unit test does not establish sandbox enforcement. The
current container fails before the probe executes: `pidfd_getfd` is denied.
Disposable-container socket and synthetic network fixtures have passed; provider authentication and model inference remain unverified. These results do not make the current shared container suitable for live role execution.

Both `run ROLE` and `run ROLE --resume` are explicitly disabled in source. There
is no environment-variable bypass. Enable only in a reviewed change after live
filesystem, network, socket, subprocess and restore checks pass. The proposed
Codex invocation delegates sandbox enforcement to nono; running it directly
would bypass that boundary. Do not copy the inner invocation into a terminal.

## Remaining activation work

1. Decide on an environment supporting the required nono mediation. Changes to
   shared container privileges require separate approval and runtime coordination.
2. Prove allowed provider access and denied other network/control endpoints.
3. Prove Herdr native restoration retains the outer launcher, sandbox and role
   ownership. The personal `herdr-replay` skip is only one restore path.
4. Preparation locking is implemented and tested; resolve credential-refresh behavior, then run a
   bounded model trial with an agreed provider/data and spend allowance.
5. Enable activation, add narrow command installation/aliases and run the three
   role collaboration exercise. No autonomous scheduling in this pilot.

The generated profile and launch command are candidates for verification, not a
claim of effective least privilege. Existing Scrum and Firstmate stay independent.

## Candidate HOME grants

The role source grants only .codex and role-specific subdirectories under
.config, .cache and .local/state, plus its output and temporary directories.
It does not grant the entire child HOME or XDG parent directories. Existing
prepared profiles are not automatically refreshed by a source edit. The launcher
already separates supervisor HOME from child HOME; the narrowed grants still
need live verification in the selected environment before activation.

## Harness choice

André requires Codex, Claude Code and Pi as selectable harnesses. Current source is
an explicit adapter boundary in scripts/roe_role_harnesses.py. Codex is a disabled
candidate; Claude and Pi are selectable unverified entries that refuse preparation
and launch before state changes. This does not claim three working adapters.
roles/codex-runtime.json pins only the Codex native executable, separately from
role identity. A changed executable is refused until reviewed. Adapter-specific
state/auth/instruction/session/resume behaviour must be verified before each
harness is marked supported. Cross-harness continuation uses durable checkpoints,
not another provider's native resume command. No silent fallback.


## Adapter boundary verified offline — 2026-09-28

All 14 launcher fixture tests pass. Shared role preparation, locking and policy
assembly use the selected adapter. Codex owns its executable pin, configuration,
authentication link, private paths, environment and invocation. Inspection of an
unverified adapter does not assume Codex state. No implicit native `resume --last`
is permitted: resumption needs a verified binding to the intended provider session.

Activation remains disabled for every adapter. Historical disposable-container
probe evidence predates this extraction; its generator pins must be refreshed as
part of a new bounded acceptance fixture, not silently treated as current proof.

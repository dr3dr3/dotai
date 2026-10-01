# Operator requests — command families and recipes

This is personal tooling for André's one operator pane. It is a review surface,
not a grant. A request is executable only when André selects it and types `run`.
Existing GitHub environment approvals, Firstmate reservations and production
command surfaces still apply. The trusted `roe-operator.ts` inbox is for personal
sessions with access to that private directory. Narrow role agents must submit
through a reviewed, bound outbox/collector; do not grant them the whole inbox.

## Evidence for the initial families

A read-only survey on 2026-09-30 parsed 296 shell-history entries from the local
bash/zsh/fish files and command headers from 60 captured `/workspace/tmp` logs.
It printed aggregate command families only: no raw command lines, arguments or
log bodies. History is incomplete, terminal aliases obscure some commands, and
captured logs include experiments whose nonzero exit was expected.

Observed examples: AWS SSO login (5 history entries), Terraform login (3),
GitHub authentication, AWS Personalize administration/reads, guarded Make/roe
operations, `roe-coordination run` (8 captured logs), and an explicit
`roe-coordination recover`. These justify the initial recipes and an
explicit recovery exception; they do not justify granting broad `aws`, `make`,
`terraform` or shell execution to agents.

## Choosing the route

| Family | Agent action | Operator request | Existing authority |
|---|---|---|---|
| Interactive authentication | Prepare `auth`; never collect a credential in request fields | `aws-sso`, `terraform` or `gh` login in the operator pane | André's personal identity and interactive login |
| Read-only diagnostic requiring André's environment | Prepare a bounded script using `templates/script.sh`, then `diagnostic` | Review script snapshot and run | Read-only identity; direct agent execution remains preferable when authorised |
| Shared local runtime | Firstmate task and exact script first; then `local-runtime` | Review full stage/test/restore script and run | `roe-coordination run --home ... --task ...` reservation; task registration is not permission |
| CLI-driven Terraform | Prepare the exact stack and full reviewed revision; use the repo Make target | Review stack, revision and plan, then answer Terraform's prompt for an apply | Make preflights, personal HCP identity and existing workspace controls |
| Production release | Agent runs `make release-status` and assembles the batch; then `release` with exact staging SHA, summary and honest validation | Review the Make preview, type the repo alias, then watch the workflow and run `make release-verify` | `make release-ship` and its workflow preflight; a request is not approval |
| Approved workflow dispatch | Choose exact repository, workflow filename, ref and inputs; then `workflow` | Review inputs and dispatch | Workflow's own CODEOWNER, environment and release controls |

AWS Personalize `stop-recommender` appeared in history. It is a cloud write, and
there is no safe generic `aws` recipe here. Assess its target, identity,
preconditions and restoration separately; prepare a dedicated operation only
when the existing authority is clear. Terraform apply has a named Make recipe
below. Production data changes, migration or deployment must retain their purpose-built reviewed surfaces. Do
not disguise them as `diagnostic` scripts.

`roe-coordination recover` is an explicit human reconciliation path. It remains
outside the queue: inspect ownership, process and staging state in the existing
procedure before running it. A generic queued `recover` would make the command
look routine and may miss a changed runtime state.

## Preparing a request

The origin should identify the task/session and a return destination. Summaries
contain no secret values. Keep workflow inputs and script contents free of
credentials; fetch protected data only through approved identities at execution.

```bash
OP=~/.claude/skills/run-this/scripts/roe-operator.ts
node "$OP" submit auth --slug aws-sso-login --purpose 'Renew the personal AWS SSO session' --auth aws-sso --origin '<work reference>'
node "$OP" submit auth --slug terraform-login --purpose 'Authenticate the personal Terraform CLI' --auth terraform --origin '<work reference>'
node "$OP" submit terraform --slug infra-plan --purpose 'Plan a reviewed stack' --tf-action plan --stack env-staging/platform-layer/data-refresh-pipeline --revision '<full-reviewed-HEAD-SHA>' --origin '<work reference>'
node "$OP" submit terraform --slug infra-apply --purpose 'Apply the approved plan for this stack' --tf-action apply-after-image --stack env-staging/platform-layer/data-refresh-pipeline --revision '<full-reviewed-main-SHA>' --origin '<work reference>'
node "$OP" submit diagnostic --slug api-read-check --purpose 'Inspect a bounded API condition' --script /workspace/tmp/api-read-check.sh --origin '<work reference>'
node "$OP" submit local-runtime --slug eng-1234-local-verify --purpose 'Stage, test and restore a candidate' --home /workspace/.firstmate-home --task '<existing-task-id>' --script /workspace/tmp/eng-1234-local-verify.sh --origin '<work reference>'
node "$OP" submit workflow --slug approved-dispatch --purpose 'Dispatch the reviewed operation' --repo rock-of-eye/rock-of-eye-api --workflow '<exact-workflow.yml>' --ref '<reviewed-ref>' --field 'key=value' --origin '<work reference>'
```

The script recipes freeze a private copy and SHA-256 digest at submission. The
operator sees that snapshot, origin, purpose, command and digest. Do not replace
it with a newly edited script under the same request; submit another request.
Shell metacharacters in inputs are passed as arguments, never evaluated by a
shell in the request builder. Avoid putting secret values in the fields at all.

## Production release through Make

The agent runs `make release-status` directly because it is read-only. To ask André to ship, prepare:

```bash
node "$OP" submit release --slug api-release --purpose 'Ship the reviewed API release candidate' --repo api --staging-sha '<full-current-staging-SHA>' --summary '<one-line release summary>' --validation staging --validated-sha '<full-SHA-actually-exercised>' --origin '<work reference>'
```

This recipe accepts only the six live production release aliases from `release.sh` and invokes `make -C /workspace release-ship`. The staging SHA is mandatory and re-read from GitHub immediately before Make starts; a moved or unreadable tag refuses the request. `--validated-sha` is optional and means the commit actually exercised during validation, which may be an ancestor of staging. Never fill it with staging SHA merely to satisfy a field. `--fleet 1` is API-only and retains the existing workflow migration approval.

Make shows the actual batch and asks André to type the repo alias before dispatch. A successful Make exit means dispatch, not deployment. The command output stays in Herdr and the request record stores its exit code; the GitHub workflow run and a direct, read-only `make release-verify` establish the outcome.

## One operator pane

André opens one Herdr shell pane and starts:

```bash
node ~/.claude/skills/run-this/scripts/roe-operator.ts serve
```

The pane lists pending requests. Press Enter to refresh, select a number to
inspect the exact command and frozen script, then type `run` to execute. A
non-executed request remains pending. Read-only scripts and workflow
dispatches use quiet `capture.sh` and expose a log path rather than streaming a
wrapped terminal into Herdr. Interactive logins
run directly and record their exit status, not credential-bearing output.
Terraform Make targets already own a pseudo-terminal and transcript, so the
operator runs those directly to avoid a nested TTY. Their private transcript
path and exit status are recorded in the request file. Native Terraform
transcripts are not scrubbed by `run-this`; treat them as private operator
records and share only the reviewed result. A request refuses to run if
infrastructure HEAD has changed since submission. If the pane exits during
execution, status remains `running` and must be reconciled against the log and the external
system before any retry. No automatic retry is offered.

The inbox is `/workspace/tmp/operator-requests` (0700, private to the current
user); request JSON and frozen scripts are 0600. `ROE_OPERATOR_INBOX` and
`RUN_THIS_LOG_DIR` support isolated tests, not a way for restricted sessions to
pick another trust boundary. This is one-machine personal state. Do not call it
authenticated cross-agent transport or assume it survives a machine reset.

The initial interface still requires André to refresh and inspect. Connecting
bound role outboxes and automatically returning a result to the originating
session belongs with the Concierge continuity collector after its provenance and
sandbox boundaries are proved. Until then, the originating session may read the
request record/log when authorised, or André can provide its path. No session
should silently scrape an unrelated operator result.

## Result checks

Before using captured output as evidence, require its final DONE marker,
inspect `rc`, target/instance/cwd, and check for missing sections. For native
Terraform, inspect the request status and Make transcript instead; a completed
operator request is not itself proof that the post-apply drift check passed. A workflow
successfully *dispatched* is not yet a successful deployment or completed data
operation: follow the workflow's own run and completion evidence. A local runtime
failure may retain the reservation; consult `roe-coordination status` and the
registered owner, never automatically recover. Never treat a timeout as proof
that a write did not happen.

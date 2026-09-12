# Terraform authority lane

This lane lets Firstmate prepare infrastructure changes without turning cloud
authority into ambient worker access. The infrastructure repository's ADRs and
workspace configuration remain authoritative; this document does not replace
their CLI-, VCS-, or GitHub Actions-driven trigger strategy.

## 1. Worker: edit and commit

The worker:

1. reads the relevant infrastructure ADRs and runbooks;
2. edits only its Treehouse worktree under the registered
   `/workspace/repos/infrastructure` project;
3. may run credential-free static checks such as `terraform fmt -check`;
4. commits the scoped change; and
5. reports the exact commit SHA, changed stack, expected resource changes,
   validation performed, and unresolved assumptions.

The worker must stop before `terraform init` if it would select a remote
backend or require credentials. It must never run plan, apply, destroy, import,
state mutation, taint, force-unlock, or a targeted apply.

## 2. Captain: classify the execution method

Before requesting a plan, the captain verifies:

- the reported SHA exists and the worktree is clean;
- the Terraform working directory and workspace are explicit;
- the repository's current ADR and workspace configuration identify the
  canonical trigger as CLI, VCS, or GitHub Actions;
- no unrelated commit or stack is included; and
- the operation is a normal plan, not a disguised state or destroy operation.

The captain then asks the human for plan authority, naming:

```text
revision: <full SHA>
working directory: <repo-relative path>
workspace: <Terraform Cloud workspace>
environment: <management|sandbox|staging|production>
execution method: <CLI|VCS|GitHub Actions>
credentials/broker: <logical source, never a secret value>
```

A broad instruction such as “do the Terraform work” is not apply approval.

## 3. Plan: exact revision, local artifact

After explicit plan approval, use the canonical execution method for that
workspace. Do not plan from the worker's `/workspace/repos/infrastructure`
Treehouse checkout: the canonical infrastructure toolchain and operator
credentials belong to the promoted `/workspace/infrastructure` volume and its
infrastructure devcontainer.

For a CLI-driven workspace, fetch the worker's committed revision into the
canonical clone and use a clean detached worktree under
`/workspace/infrastructure/.worktrees/` at that exact SHA. Do not switch or
overwrite the canonical checkout's active branch. VCS- and GitHub-driven
workspaces must use their established PR/check workflow, with checkout pinned
to the reported SHA.

For CLI plans:

- create a saved plan;
- render its JSON only to a private, ignored local path;
- run the infrastructure repository's `scripts/terraform-plan-guard.sh`;
- do not paste raw plan JSON into Firstmate reports, issues, PR comments, or
  the permission ledger because plan files may contain sensitive values; and
- report the run URL/identifier, revision, workspace, resource action counts,
  replacements/deletes, guard result, and warnings.

Any deletion is refused by default. An expected-destroy exception must name the
exact resource and is a separate human decision.

## 4. Review and merge

The PR follows the infrastructure repository's normal review and merge rules.
A pre-merge plan is evidence for review, not authority to apply.

After merge, resolve the exact merged revision. If it differs from the reviewed
revision, or remote state has changed, the previous plan is stale.

## 5. Fresh plan on the merged revision

From a clean checkout at the merged revision:

1. run a fresh plan through the same canonical workspace;
2. run the plan guard again;
3. summarize the delta without exposing sensitive values; and
4. ask for explicit apply approval tied to this revision, workspace, and plan
   run or artifact.

Never apply a worker's pre-merge plan.

## 6. Human-gated apply

Apply only the reviewed saved plan or approved remote run through the
repository's established Terraform Cloud/GitHub approval mechanism. The
captain may coordinate and report the operation; a worker never receives the
credentials or authority to initiate it.

Stop if:

- the checkout SHA, plan SHA/run, workspace, or environment does not match the
  approval;
- the plan contains an unapproved delete or replacement;
- approval would be bypassed by `-auto-approve`, a direct provider call, or an
  alternate workspace;
- credentials would need to be copied into a worktree, prompt, report, or
  ledger; or
- the canonical repository workflow is missing or contradicts its ADR.

## Initial permission candidates

Capture these as evidence while `nono` is off; do not pre-grant them:

- captain read/write access to the exact infrastructure worktree and its local
  `.terraform`/plan artifacts;
- captain/operator access to a clean exact-SHA worktree on the canonical
  `/workspace/infrastructure` volume;
- execution of the pinned Terraform toolchain;
- network access to the Terraform Cloud API used by the selected workspace;
- read access to a plan-capable Terraform CLI credential or broker;
- GitHub read/write needed to open the PR and observe established checks.

Remote Terraform Cloud workspaces using workload identity should not require
ambient AWS credentials in the captain or worker process. A workspace that
uses local execution is a different workflow and needs a separate permission
review.

## Current OTel D8 mapping

At the time this lane was introduced, the production application-health alarms
used by the OTel rollout were in:

```text
terraform/env-production/foundation-layer/deploy-alerts
workspace: production-foundation-deploy-alerts
```

That stack is CLI-driven with Terraform Cloud remote execution and
`auto_apply = false`. The expected lane is therefore: worker commit, reviewed
PR, explicitly approved remote CLI plan, plan guard and summary, merge, fresh
remote plan on the merged revision, then the Terraform Cloud human apply gate.
The captain must re-read the live backend/workspace configuration before acting
rather than treating this paragraph as permanent runtime proof.

# Firstmate permission discovery

Keep permission discovery separate from permission granting.

While `fm-sandbox off` is active, record capabilities that a real workflow
needs in the private ledger:

```bash
fm-permission-note \
  --boundary credential \
  --access read \
  --resource terraform-cli-credentials \
  --reason "Queue an explicitly approved remote Terraform plan" \
  --evidence declared
```

The ledger lives at
`/workspace/.firstmate-home/data/permission-needs.jsonl`. Never put tokens,
passwords, secret values, environment dumps, or complete credential-bearing
commands in it. An entry is evidence for later review; it grants nothing and
does not authorize the operation it describes.

With `nono` on, a worker deliberately cannot write the captain's private
`FM_HOME`. It reports the need in its task result and the captain records it;
do not widen the worker profile merely to let it edit the ledger.

## Lifecycle

1. **Capture** the logical capability, role, access, resource, reason, evidence,
   sandbox mode, repository, and revision.
2. **Cluster** related entries into a complete workflow. Do not widen a profile
   for each command as it appears.
3. **Challenge** every entry: remove duplicates, prefer a broker or read-only
   token, and separate filesystem access from operational authority.
4. **Grant** the minimum profile change needed for one reviewed workflow.
5. **Verify** it with a positive test for the intended operation and a negative
   test proving adjacent authority remains denied.
6. **Reject or retire** entries that are unnecessary or superseded.

Successful execution with `nono` off is weak evidence: it proves the workflow
used a capability, not that a proposed path or credential grant is minimal.
The strongest evidence is a reproducible denial with `nono` on, followed by a
narrow grant and both positive and negative regression tests.

## Authority is not an OS permission

Being able to read a token, contact an API, or execute a binary does not
authorize the resulting external action. The crew policy must independently
decide whether the role may initiate that action.

For Terraform:

- workers may edit committed configuration and run credential-free static
  checks;
- workers may not plan, apply, destroy, import, mutate state, or widen their
  own permissions;
- a captain may request a plan only after naming the committed revision,
  workspace, environment, and canonical execution method;
- apply requires a fresh plan for the merged revision, a reviewed summary, and
  explicit human approval through the repository's established Terraform
  Cloud or GitHub environment gate;
- destroy, import, state mutation, force-unlock, and targeted applies remain
  break-glass operations outside this lane.

See [`terraform-authority-lane.md`](terraform-authority-lane.md) for the full
handoff.

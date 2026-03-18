Review and clean up git branches across all RoE repos. Use this skill whenever the user asks to "review git branches", "cleanup our git branches", "check our branches", "tidy up branches", or anything about auditing, pruning, or managing branches across repos. Proactively use this skill when the user mentions wanting to clean up local branches or check which branches have been merged.

This skill audits every local branch in every cloned RoE repo — checking whether branches have been merged to trunk, whether they're in sync with their remote, and offering to delete safe-to-remove branches after user confirmation.

## Step 1: Verify GitHub CLI Authentication

```bash
gh auth status
```

If the command fails or shows "not logged in", stop and tell the user:

> You need to log in to the GitHub CLI first. Run `gh auth login` and follow the prompts, then re-run this skill.

## Step 2: Discover Repos and Their Trunk Branches

Read `repos.yaml` from the workspace root to get the list of repos and their `default_branch`. The repos are cloned into `/workspace/repos/` (using the key as the directory name).

Only process repos that are actually cloned (the directory exists). Skip silently if a repo isn't present locally.

## Step 3: For Each Repo, Audit All Local Branches

For each cloned repo, run the following steps:

### 3a. Fetch remote state

```bash
cd /workspace/repos/{repo_name}
git fetch --prune 2>&1
```

Fetching ensures remote tracking refs are up to date, and `--prune` removes stale remote refs for deleted remote branches.

### 3b. Check trunk sync status

```bash
git rev-list --left-right --count origin/{default_branch}...{default_branch}
```

Output is `{behind}\t{ahead}`. Record this for the summary — a trunk that's behind origin means the local repo hasn't been pulled recently and any branching done from it will be stale.

### 3c. List non-trunk local branches

```bash
git branch --format='%(refname:short)'
```

Exclude the trunk branch (e.g. `master` or `main`). If there are no non-trunk branches, note "no feature branches" and move on.

### 3c. For each non-trunk branch, gather status

Run these checks and record the results:

**Merged into trunk?**
```bash
git branch --merged {default_branch} | grep -w "{branch_name}"
```
If this outputs the branch name, it's been fully merged.

**Exists on remote?**
```bash
git ls-remote --heads origin {branch_name}
```
Empty output means the branch doesn't exist on the remote.

**Up to date with remote?** (only relevant if it exists on remote)
```bash
git rev-list --left-right --count origin/{branch_name}...{branch_name}
```
Output is `{behind}\t{ahead}`. If both are `0`, fully in sync. If ahead > 0, local has unpushed commits. If behind > 0, remote has commits local doesn't have.

## Step 4: Present the Summary

After checking all repos, present two things:

**1. Trunk health table** — always show this for every repo:

```
## Trunk Status
| Repo | Branch | Behind origin | Ahead of origin |
|------|--------|--------------|-----------------|
| rock-of-eye-api | master | ⚠️ 216 behind | 0 ahead |
| rock-of-eye-sso | master | ✅ In sync | 0 ahead |
| rock-of-eye-all-in-one-portal | master | ✅ In sync | 0 ahead |
```

Flag any repo where trunk is behind with ⚠️ — this means `git pull` is needed before any new branching work.

**2. Feature branch table** — only show repos that have non-trunk branches:

```
## Feature Branches

### rock-of-eye-api
| Branch | Merged to master | Remote | Sync Status |
|--------|-----------------|--------|-------------|
| feat/ROE-45-add-xero-export | ✅ Merged | ✅ Exists | In sync |
| fix/ROE-67-payment-bug | ❌ Not merged | ✅ Exists | 2 ahead, 0 behind |
| chore/old-experiment | ✅ Merged | ❌ No remote | N/A |

### rock-of-eye-all-in-one-portal
| Branch | Merged to master | Remote | Sync Status |
|--------|-----------------|--------|-------------|
| feat/ROE-89-client-dashboard | ❌ Not merged | ✅ Exists | 0 ahead, 3 behind — remote has updates |
```

Use these status indicators:
- ✅ Merged / ❌ Not merged
- ✅ Exists (on remote) / ❌ No remote
- Sync: "In sync", "N ahead", "N behind", "N ahead, N behind"

At the bottom, list a summary of branches that are **safe to delete** (merged to trunk):

```
## Safe to Delete (merged to trunk)
- rock-of-eye-api: feat/ROE-45-add-xero-export
- rock-of-eye-api: chore/old-experiment
```

## Step 5: Offer to Delete Merged Branches

Ask the user for confirmation before deleting anything:

> These branches have been merged into trunk and can be safely deleted locally. Would you like me to delete them?
> - `rock-of-eye-api`: feat/ROE-45-add-xero-export
> - `rock-of-eye-api`: chore/old-experiment
>
> Reply "yes" to delete all, "no" to skip, or list specific branches to delete.

Once the user confirms (all or specific), delete each one:

```bash
cd /workspace/repos/{repo_name}

# If the repo is currently on this branch, switch to trunk first
git rev-parse --abbrev-ref HEAD  # check current branch
git checkout {default_branch}    # only if HEAD == branch_name

git branch -d {branch_name}
```

Switching to trunk is safe — the branch is already confirmed merged, so no work is lost. Always switch back to the default branch rather than forcing the user into a detached HEAD state.

Use `-d` (not `-D`) since the branch is already confirmed merged — this is a safety net. If `-d` fails unexpectedly, report the error and do not force-delete.

Do **not** delete remote branches — only clean up local copies.

## Step 6: Highlight Branches Needing Attention

After deletions, flag any branches that may need action:

- **Behind remote**: remote has commits the local branch doesn't have — user may want to `git pull`
- **Ahead of remote**: local has commits not pushed — user may want to `git push`
- **Not merged, no remote**: local-only branch with unmerged work — worth the user knowing about

Format these as actionable notes:

```
## Branches Needing Attention

- **rock-of-eye-all-in-one-portal** `feat/ROE-89-client-dashboard`
  ↓ 3 commits behind remote — run `git pull` to catch up

- **rock-of-eye-api** `fix/ROE-67-payment-bug`
  ↑ 2 commits ahead of remote — run `git push` to publish
```

## Tips

- Repos where the directory doesn't exist under `repos/` should be silently skipped (the user may not have cloned all repos)
- If `git fetch` fails (e.g. no network or no remote access), note it but continue with cached remote state
- If the repo is currently on a branch being deleted, switch to trunk first before deleting — never leave the user in a detached HEAD state
- Never delete the trunk branch itself
- If all repos have no feature branches, tell the user the workspace is clean — no action needed

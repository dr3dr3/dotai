Ship completed work for a Linear task — create branch, commit, push, and open PR.

Usage: Provide the Linear issue identifier, e.g. `/linear-ship-task ROE-123`

This command handles the full git workflow after code changes have been made and reviewed locally. It creates a properly named branch, commits with a conventional commit message, pushes, and opens a draft PR on GitHub.

## Prerequisites

The `LINEAR_API_KEY` environment variable must be set. Load it from `.env` if needed:

```bash
export LINEAR_API_KEY=$(grep LINEAR_API_KEY .env | cut -d= -f2)
```

GitHub CLI (`gh`) must be installed and authenticated for the relevant GitHub orgs.

Repository conventions are defined in `repos.yaml` at the workspace root.

## Workflow

Follow these steps in order.

### Step 1: Fetch Issue Details from Linear

Fetch the issue to get its identifier, title, labels, description, project, and current state:

```python
import json, subprocess, os, re, sys

api_key = os.environ.get('LINEAR_API_KEY')
if not api_key:
    print("ERROR: LINEAR_API_KEY not set"); sys.exit(1)

identifier = "$ARGUMENTS"  # e.g. "ROE-123"
match = re.match(r'^([A-Z]+)-(\d+)$', identifier.strip())
if not match:
    print(f"ERROR: Invalid identifier format: {identifier}"); sys.exit(1)

team_key = match.group(1)
number = int(match.group(2))

query = """
query($teamKey: String!, $number: Float!) {
  issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
    nodes {
      id identifier title description priority url
      state { id name type }
      labels { nodes { id name } }
      project { id name url }
      projectMilestone { id name }
    }
  }
}
"""

variables = {"teamKey": team_key, "number": number}
payload = json.dumps({"query": query, "variables": variables})

result = subprocess.run([
    'curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
    '-H', 'Content-Type: application/json',
    '-H', f'Authorization: {api_key}',
    '-d', payload
], capture_output=True, text=True)

data = json.loads(result.stdout)
nodes = data.get('data', {}).get('issues', {}).get('nodes', [])
if not nodes:
    print(f"ERROR: Issue {identifier} not found"); sys.exit(1)

issue = nodes[0]
print(json.dumps(issue, indent=2))
```

### Step 2: Determine Target Repositories

Parse the `**Repo:**` field from the issue description to find which repos have changes:

```python
repo_match = re.search(r'\*\*Repo:\*\*\s*(.+?)(?:\n|$)', issue.get('description', '') or '')
if repo_match:
    declared_repos = [r.strip() for r in repo_match.group(1).split(',')]
    declared_repos = [r for r in declared_repos if r and r.lower() != 'n/a']
```

Then **scan all repos under `roe-codebase/`** for uncommitted changes (modified, added, or untracked files) using `git status --porcelain`. Compare against the declared repos.

Present findings to the user:

```
## Repositories with Changes
| Repo | Declared in Issue | Has Changes | Changed Files |
|------|-------------------|-------------|---------------|
| rock-of-eye-api | Yes | Yes | 5 files |
| rock-of-eye-all-in-one-portal | No | Yes | 2 files |
```

If repos with changes don't match the declared repos, flag this and ask the user to confirm which repos to ship.

Read `repos.yaml` for each target repo's metadata (github org/repo, default branch).

### Step 3: Determine Branch Name and Commit Type

Read the conventions from `repos.yaml`. Map the issue's **first label** to branch prefix and commit type:

**Branch prefix mapping** (from `repos.yaml` → `conventions.branch_prefixes`):
- Feature → `feat/`
- Fix → `fix/`
- Improvement → `feat/`
- Configuration → `chore/`
- Infra labels → `chore/`
- Default (no matching label) → `feat/`

**Commit type mapping** (from `repos.yaml` → `conventions.commit_types`):
- Feature → `feat`
- Fix → `fix`
- Improvement → `refactor`
- Configuration → `chore`
- Default → `chore`

**Generate the branch slug** from the issue title:
1. Convert to lowercase
2. Replace non-alphanumeric characters with hyphens
3. Collapse multiple hyphens
4. Trim to 50 characters (from `conventions.slug_max_length`)
5. Remove trailing hyphens

**Final branch name:** `{prefix}/{identifier}-{slug}`
Example: `feat/ROE-123-add-clarity-tracking-to-portals`

**Final commit message:** `{type}({identifier}): {short description}`
Example: `feat(ROE-123): add Clarity tracking script to all portals`

Present the proposed branch name and commit message to the user for approval before proceeding.

### Step 4: For Each Target Repo — Branch, Commit, Push

Process each repo sequentially. For each:

#### 4a. Navigate and verify

```bash
cd {workspace_root}/roe-codebase/{repo_name}
```

Verify there are actual changes:
```bash
git status --porcelain
```

If no changes, skip this repo.

#### 4b. Ensure starting from default branch

If already on the default branch (e.g., `master`), good. If on a different branch, warn the user and ask before proceeding.

#### 4c. Create branch

```bash
git checkout -b {branch_name}
```

#### 4d. Stage changes

Review the changed files and stage them:

```bash
git add -A
```

If there are files that shouldn't be committed (unrelated changes, temp files), ask the user before staging. Use `git add {specific_files}` for selective staging if needed.

#### 4e. Commit

```bash
git commit -m "{commit_message}"
```

If the changes warrant a longer commit body (multiple significant changes), use:

```bash
git commit -m "{commit_message}" -m "{body with details}"
```

#### 4f. Push

```bash
git push -u origin {branch_name}
```

### Step 5: Create Pull Requests

For each repo that was pushed, create a draft PR using GitHub CLI:

```bash
cd {workspace_root}/roe-codebase/{repo_name}

gh pr create \
  --base {default_branch} \
  --head {branch_name} \
  --title "[{identifier}] {issue_title}" \
  --body "{pr_body}" \
  --draft
```

**PR body template:**

```markdown
## {identifier}: {issue_title}

**Linear Issue:** {issue_url}
**Project:** {project_name} ({project_url})
**Milestone:** {milestone_name}
**Priority:** {priority_label}

### Description
{issue description or a concise summary of the changes}

### Changes
{list of key changes made in this repo}

### Cross-Repo Changes
{If this task spans multiple repos, list the other repos and their PR links here.
Example: "Related PR in rock-of-eye-api: {pr_url}"}

### Testing
- [ ] Local testing completed
- [ ] Unit tests pass
- [ ] No lint errors introduced
```

Store the PR URL for each repo.

#### Cross-Repo References

If the task involves **multiple repos**, after all PRs are created, go back and **update each PR body** to include links to the other PRs:

```bash
cd {workspace_root}/roe-codebase/{repo_name}
gh pr edit {pr_number} --body "{updated_body_with_cross_references}"
```

### Step 6: Update Linear Issue

Move the issue to "In Review" state and add a comment with the PR link(s):

```python
# Find the "In Review" state for this team
states_query = """
query {
  workflowStates(first: 100) {
    nodes { id name type team { key } }
  }
}
"""
# ... fetch states, find "In Review" for the team ...

# Update issue state
update_query = """
mutation($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}
"""
variables = {"id": issue['id'], "stateId": in_review_state_id}
# ... execute mutation ...

# Add comment with PR link(s)
comment_body = "## Pull Requests\\n\\n"
for repo_name, pr_url in pr_links:
    comment_body += f"- **{repo_name}:** {pr_url}\\n"

comment_query = """
mutation($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
}
"""
variables = {"issueId": issue['id'], "body": comment_body}
# ... execute mutation ...
```

### Step 7: Report Results

Present a final summary:

```
## Ship Summary for {identifier}

| Repo | Branch | PR | Status |
|------|--------|----|--------|
| rock-of-eye-api | feat/ROE-123-slug | #42 (draft) | ✓ |
| rock-of-eye-all-in-one-portal | feat/ROE-123-slug | #18 (draft) | ✓ |

**Linear status:** Updated to "In Review"
**Comment added:** Yes, with PR links

### Next Steps
- Review the draft PR(s) on GitHub
- Request reviewers when ready
- Once approved and merged, update Linear to "Done"
```

## Error Handling

- If `LINEAR_API_KEY` is not set, stop immediately
- If `gh` is not authenticated, tell the user to run `gh auth login`
- If a repo has no changes, skip it with a note
- If `git push` fails (e.g., branch already exists), suggest a fix or ask user
- If PR creation fails, log the error and provide the manual `gh pr create` command
- If Linear status update fails, log it — the PR was still created successfully

## Tips

- Always show the user the proposed branch name and commit message before executing
- Check `git log --oneline -5` in the target repo to confirm you're branching from the right place
- If the user has already created a branch manually, detect this and offer to use their existing branch
- For repos with `has_staging: true` (in repos.yaml), you may want to note that a staging merge may be needed before production — but the PR should still target the default branch
- The draft PR gives the user a chance to review before requesting reviewers

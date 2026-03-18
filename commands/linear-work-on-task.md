Fetch a Linear task by identifier and begin working on it.

Usage: Provide the Linear issue identifier, e.g. `/linear-work-on-task ROE-123`

The command fetches the issue details, parent project context, related ADR, and determines the target repository. Then it sets up the working context and begins implementing the task.

## Prerequisites

The `LINEAR_API_KEY` environment variable must be set. Load it from `.env` if needed:

```bash
export LINEAR_API_KEY=$(grep LINEAR_API_KEY .env | cut -d= -f2)
```

All Linear API calls use the GraphQL endpoint: `https://api.linear.app/graphql`
Authentication header: `Authorization: $LINEAR_API_KEY` (no "Bearer" prefix for personal API keys).

The target repository must be cloned under `roe-codebase/` (see `scripts/clone-roe-repos.fish`).

GitHub CLI (`gh`) must be authenticated for the relevant GitHub orgs.

## Workflow

Follow these steps in order. Use Python for all Linear API calls (consistent with `/linear-create-project`).

### Step 1: Parse the Issue Identifier

The user provides an identifier like `ROE-123`. Parse this into:
- **Team key**: `ROE` (the letters before the dash)
- **Issue number**: `123` (the number after the dash)

Validate the format matches `^[A-Z]+-\d+$`. If invalid, stop and ask the user for a valid identifier.

### Step 2: Fetch Issue Details from Linear

Make a single GraphQL query to fetch the issue with its full context — project, milestone, labels, state, and project documents:

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
      project {
        id name description url
        documents { nodes { id title content } }
      }
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

Store the returned issue data. If the issue has a `project`, proceed to Step 3 for sibling issues. Otherwise skip to Step 4.

### Step 3: Fetch Sibling Issues (Project Context)

If the issue belongs to a project, fetch all sibling issues to understand what's been done and what's ahead:

```python
project_id = issue['project']['id']

query2 = """
query($projectId: String!) {
  project(id: $projectId) {
    issues(first: 250) {
      nodes {
        identifier title priority
        state { name type }
        projectMilestone { name }
      }
    }
  }
}
"""

variables2 = {"projectId": project_id}
payload2 = json.dumps({"query": query2, "variables": variables2})

result2 = subprocess.run([
    'curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
    '-H', 'Content-Type: application/json',
    '-H', f'Authorization: {api_key}',
    '-d', payload2
], capture_output=True, text=True)

data2 = json.loads(result2.stdout)
sibling_issues = data2['data']['project']['issues']['nodes']
print(json.dumps(sibling_issues, indent=2))
```

Note which issues are completed (state type `completed`), in progress, and yet to start. This context helps understand ordering, dependencies, and what changes may already exist.

### Step 4: Find the Related ADR

Search for the related Architecture Decision Record using multiple strategies in order of priority:

1. **Check project description** for an ADR filename pattern (e.g., `2026-02-19-2-feature-flag-strategy.md`):
   ```python
   adr_pattern = r'(\d{4}-\d{2}-\d{2}-\d+-[a-z0-9-]+\.md)'
   text = (issue.get('project', {}) or {}).get('description', '') or ''
   text += '\n' + (issue.get('description', '') or '')
   adr_match = re.search(adr_pattern, text)
   ```

2. **Check project documents** — if the project has attached documents, look for one with "ADR" in its title or content that references `architecture-decision-records/`.

3. **Check issue description** for explicit ADR reference.

4. **Keyword search** as fallback — search `docs/architecture-decision-records/` for files with keywords from the issue or project title.

Once found, read the ADR file. It contains the decision context, rationale, and constraints that should guide the implementation.

### Step 5: Determine the Target Repository

Parse the `**Repo:**` field from the issue description:

```python
repo_match = re.search(r'\*\*Repo:\*\*\s*(.+?)(?:\n|$)', issue.get('description', '') or '')
if repo_match:
    repo_names = [r.strip() for r in repo_match.group(1).split(',')]
    repo_names = [r for r in repo_names if r and r.lower() != 'n/a']
```

Then look up each repo name in `repos.yaml` (read from the workspace root):
- Resolve the local path: `{workspace_root}/roe-codebase/{repo_name}/`
- Verify the directory exists. If not, tell the user to clone it first.
- Note the repo's `default_branch`, `tech` stack, and `type` for context.

If **no Repo field** is found or it says N/A, this may be a configuration-only or documentation task. Ask the user which repo (if any) to work in.

If **multiple repos** are listed, ask the user which one to start with. Work on repos one at a time.

### Step 6: Present Context Summary

Before starting work, present a clear summary to the user:

```
## Task: {identifier} — {title}

**Status:** {state.name}
**Priority:** {priority_label}  (1=Urgent, 2=High, 3=Medium, 4=Low)
**Labels:** {label names}
**Milestone:** {milestone name}
**Project:** {project name} ({project url})

### Description
{issue description, formatted}

### Target Repository
- **Repo:** {repo_name}
- **Path:** {local_path}
- **Tech:** {tech}
- **Default branch:** {default_branch}

### ADR Context
- **File:** {adr_filename}
- **Key decisions:** {brief summary of ADR decisions relevant to this task}

### Project Progress
- Completed: {count} issues
- In Progress: {count} issues
- Remaining: {count} issues
- Sibling issues in same milestone: {list}

### Dependencies
{Any dependency task IDs mentioned in the description, with their current status}
```

Ask the user: **"Ready to start working on this? Anything to clarify?"**

Wait for confirmation before proceeding.

### Step 7: Update Linear Status to In Progress

Once the user confirms, move the issue to "In Progress" state:

```python
# First, find the "In Progress" state for this team
states_query = """
query {
  workflowStates(first: 100) {
    nodes { id name type team { key } }
  }
}
"""

# ... fetch states, find the one with name "In Progress" and matching team key ...

# Then update the issue
update_query = "mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }"
variables = {"id": issue['id'], "stateId": in_progress_state_id}
# ... execute mutation ...
```

### Step 8: Set Up Working Context

Navigate to the target repository and prepare:

1. **Ensure the repo is on the default branch and up to date:**
   ```bash
   cd {repo_path}
   git checkout {default_branch}
   git pull origin {default_branch}
   ```

2. **Read the project's CLAUDE.md** (if it exists in the target repo) for repo-specific conventions.

3. **Understand the relevant code area.** Based on the issue description:
   - For backend (Laravel) tasks: check `Modules/<Name>/` structure — routes, models, controllers, actions
   - For frontend (Vue/Quasar) tasks: check `src/pages/`, `src/components/`, `src/router/`, `src/store/`
   - For infrastructure tasks: check config files, Docker, CI/CD

4. **Read any files mentioned in the issue description** (e.g., "modify `Modules/Payment/Actions/ProcessPayment.php`").

5. **Check for related changes in recently completed sibling issues** — if other issues in the same milestone are done, examine what branches or recent commits exist.

### Step 9: Execute the Work

Now implement the task based on all gathered context:

- Follow the issue description and acceptance criteria precisely
- Respect the ADR decisions and constraints
- Follow the repo's existing code style and patterns
- Make atomic, focused changes — only what the task requires
- If the task references other tasks as dependencies, make sure those are completed (state = Done) or ask the user

When done, present a summary of the changes made and ask the user to review locally and run tests before shipping with `/linear-ship-task`.

## Error Handling

- If `LINEAR_API_KEY` is not set or the first API call fails with auth errors, stop and tell the user
- If the issue is not found, suggest checking the identifier
- If the repo is not cloned, point the user to `scripts/clone-roe-repos.fish`
- If the issue has no project, proceed anyway — just skip the project context steps
- If no ADR is found, note this and proceed — not all tasks have ADRs

## Tips

- Always fetch sibling issues — they provide crucial context about what's already built
- The `**Type:**` field in the issue description (Backend/Frontend/DevOps/QA/Docs) hints at what kind of changes to expect
- The `**Estimate:**` field gives a sense of complexity
- Project documents in Linear may contain additional context or the ADR text itself
- If a task depends on other tasks that aren't done yet, flag this to the user before proceeding

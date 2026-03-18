Create a Linear project with issues from an implementation document.

Usage: Provide the path to a markdown implementation document, e.g. "/linear-create-project docs/to-implement/my-feature.md"

The document should contain tasks/phases with titles, descriptions, estimates, priorities, and dependencies. The skill will parse the document and create a structured Linear project with all issues.

## Prerequisites

The `LINEAR_API_KEY` environment variable must be set. Load it from `/workspace/.env` if needed:

```bash
export LINEAR_API_KEY=$(grep LINEAR_API_KEY /workspace/.env | cut -d= -f2)
```

All Linear API calls use the GraphQL endpoint: `https://api.linear.app/graphql`
Authentication header: `Authorization: $LINEAR_API_KEY` (no "Bearer" prefix for personal API keys).

## Workflow

Follow these steps in order:

### Step 1: Read and Parse the Implementation Document

Read the provided markdown file. Extract all tasks, identifying for each:
- **Task ID** (e.g., "1.1", "2.3")
- **Title**
- **Phase** (group heading)
- **Type** (Backend, Frontend, DevOps, QA, Docs, etc.)
- **Priority** (P0=Urgent/1, P1=High/2, P2=Medium/3, P3=Low/4)
- **Estimate** (as text, e.g., "2-3 hours")
- **Dependencies** (other task IDs)
- **Description** (full task details including acceptance criteria)
- **Repo** (which repository the work is in, if specified)
- **ADR references** — Search the entire document for all linked Architecture Decision Records. Look in the header, introduction, references section, and inline links throughout the document for filenames matching the pattern `YYYY-MM-DD-N-description.md` or paths containing `docs/architecture-decision-records/`. Collect ALL ADR filenames found as a list (there may be more than one). Resolve each to its full workspace path (e.g., `/workspace/docs/architecture-decision-records/2026-02-20-1-testing-strategy-for-laravel-12-upgrade.md`).
- **Document path** — Store the path of the implementation document itself (as provided by the user argument).

Look for a summary table (often at the end of the document) for a quick reference, but use the full task sections for descriptions.

### Step 2: Discover the Linear Team

Query the Linear API to list teams:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ teams { nodes { id name key } } }"}'
```

Always auto-select the team named **"Engineering"** (case-insensitive match on the `name` field). Do not ask the user. If no team named "Engineering" exists, report an error and stop. Store the team ID.

### Step 3: Get Workflow States

Query for the team's workflow states so we can set the initial status (usually "Backlog" or "Todo"):

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ workflowStates { nodes { id name type team { id } } } }"}'
```

Find the "Backlog" or "Todo" state for the selected team.

### Step 4: Resolve Labels from labels.yaml

**IMPORTANT: Never create new labels.** Only use labels defined in `/workspace/labels.yaml`. This file is the single source of truth for all Linear labels.

1. Read `/workspace/labels.yaml` to get the list of allowed label names.

2. Query existing labels in Linear to get their IDs:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ issueLabels(first: 250) { nodes { id name } } }"}'
```

3. Match each label name from `labels.yaml` to its Linear ID. Build a lookup map of `name -> id`.

4. For each task in the document, map it to the most appropriate label(s) from `labels.yaml` based on the task's nature:

| Task Nature | Label |
|-------------|-------|
| New capability / integration | **Feature** |
| Configuration-only (no code) | **Configuration** |
| Improving existing functionality | **Improvement** |
| Bug fix | **Fix** |
| Infrastructure via console/UI | **Infra - Click Ops** |
| Infrastructure via code/IaC | **Infra - IaC** |
| Monitoring, operations | **IT Operations** |
| Research, investigation | **Analysis** |
| Solution design, ADR | **Architecture** |
| Data migration/import work | **Data Importing** |

5. If no label is a good fit for a task, assign no label rather than creating a new one.

**Do NOT create phase labels** -- phases are already represented by milestones (Step 6).
**Do NOT create task-type labels** (e.g., "Frontend", "Backend", "QA", "DevOps", "Docs") -- these are not in `labels.yaml`. Instead, include the task type in the issue description metadata.

### Step 5: Create the Project

Create a Linear project and associate it with the team. **Always use Python with variable-based mutations** to safely handle special characters in names and descriptions.

**Building the description:** The project description should be a human-readable summary of what the project is and why it exists, followed by traceability metadata. Derive the summary from the implementation document's **Overview**, **Executive Summary**, or introductory section — extract 2-5 sentences that describe the goal, the problem being solved, and the key outcome. Do not copy the full document; write a concise paragraph. Then append the metadata footer.

```python
import json, subprocess, os

api_key = os.environ['LINEAR_API_KEY']
query = 'mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { success project { id name url } } }'

# Build description:
# 1. A concise human-readable summary extracted from the document's overview/intro section
# 2. A blank line
# 3. A metadata footer with traceability links
# This metadata is used by /linear-work-on-task to find the ADR and implementation doc
adr_list = '\n'.join(f'- {adr}' for adr in adr_filenames) if adr_filenames else 'N/A'
description_lines = [
    # 2-5 sentence summary derived from the document overview — describe the goal,
    # problem being solved, and the key outcome. Write in plain prose, not bullet points.
    '<summary derived from document overview section>',
    '',
    '---',
    f'**Implementation Plan:** {doc_path}',
    f'**ADRs:**',
    adr_list,
]

variables = {
    'input': {
        'name': 'Project Name From Document Title',
        'teamIds': ['TEAM_ID'],
        'description': '\n'.join(description_lines)
    }
}
payload = json.dumps({'query': query, 'variables': variables})
result = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
    '-H', 'Content-Type: application/json',
    '-H', f'Authorization: {api_key}',
    '-d', payload], capture_output=True, text=True)
data = json.loads(result.stdout)
```

Store the returned project ID and URL.

### Step 6: Create Project Documents for Each ADR

For each ADR filepath collected in Step 1, create a Linear project document attached to the project. This gives the team direct access to the architectural decisions behind the work without leaving Linear.

**For each ADR:**
1. Read the full markdown content of the ADR file from the workspace
2. Extract the title: find the first `# Heading` line (the top-level H1). Strip the `# ` prefix — this becomes the Linear document title.
3. Remove that first H1 line from the content. The remaining markdown is the document body.
4. Create the project document using the `projectDocumentCreate` mutation.

The Linear document content field accepts markdown. Preserve all markdown formatting from the ADR (headings, tables, code blocks, etc.).

```python
import json, subprocess, os, re

api_key = os.environ['LINEAR_API_KEY']
project_id = 'PROJECT_ID'  # from Step 5

query = '''mutation($input: ProjectDocumentCreateInput!) {
  projectDocumentCreate(input: $input) {
    success
    document {
      id
      title
      url
    }
  }
}'''

adr_paths = [
    # list of resolved ADR file paths collected in Step 1
    # e.g. '/workspace/docs/architecture-decision-records/2026-02-20-1-testing-strategy.md'
]

created_docs = []
for adr_path in adr_paths:
    with open(adr_path, 'r') as f:
        raw = f.read()

    lines = raw.splitlines()

    # Extract the H1 title (first line starting with '# ')
    title = None
    body_lines = []
    for i, line in enumerate(lines):
        if title is None and line.startswith('# '):
            title = line[2:].strip()  # strip '# ' prefix
        else:
            body_lines.append(line)

    if not title:
        print(f'WARN: No H1 heading found in {adr_path} — skipping')
        continue

    body = '\n'.join(body_lines).strip()

    variables = {
        'input': {
            'projectId': project_id,
            'title': title,
            'content': body,
        }
    }
    payload = json.dumps({'query': query, 'variables': variables})
    result = subprocess.run(
        ['curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
         '-H', 'Content-Type: application/json',
         '-H', f'Authorization: {api_key}',
         '-d', payload],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)
    doc = data.get('data', {}).get('projectDocumentCreate', {}).get('document', {})
    if doc:
        created_docs.append({'adr': adr_path, 'title': title, 'url': doc.get('url', '')})
        print(f'Created document: "{title}" — {doc.get("url", "")}')
    else:
        print(f'FAILED to create document for {adr_path}: {result.stdout}')
```

Include the created document URLs in the final report (Step 9).

---

### Step 7: Create Milestones for Each Phase

For each phase identified in the document, create a project milestone. Milestones help organize work and track progress at the phase level.

First, extract unique phases from the parsed tasks. For each phase, determine:
- **Name**: e.g., "Phase 1: Setup and Configuration"
- **Target Date**: Calculate based on phase sequence and estimated effort (optional, can be set later)
- **Sort Order**: Sequential (1, 2, 3, etc.)

Create milestones using Python variable-based mutations for consistency:

```python
import json, subprocess, os

api_key = os.environ['LINEAR_API_KEY']
query = 'mutation($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success projectMilestone { id name sortOrder } } }'

phases = [
    {'name': 'Phase 1: Setup', 'sortOrder': 1},
    {'name': 'Phase 2: Implementation', 'sortOrder': 2},
]

for phase in phases:
    variables = {
        'input': {
            'name': phase['name'],
            'projectId': 'PROJECT_ID',
            'sortOrder': phase['sortOrder']
        }
    }
    payload = json.dumps({'query': query, 'variables': variables})
    result = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
        '-H', 'Content-Type: application/json',
        '-H', f'Authorization: {api_key}',
        '-d', payload], capture_output=True, text=True)
    data = json.loads(result.stdout)
```

Store the milestone IDs mapped to their phase names/numbers for use in Step 8.

### Step 8: Create Issues Using Python Variable-Based Mutations

**IMPORTANT: Do NOT use inline GraphQL string aliases for issue creation.** Titles and descriptions often contain quotes, parentheses, backticks, and other special characters that break inline GraphQL strings. Always use Python with `json.dumps()` and variable-based mutations for safe escaping.

Each issue should include:

- `title`: Prefixed with task ID, e.g., "[1.1] Create Clarity account and configure projects"
- `teamId`: From Step 2
- `projectId`: From Step 5
- `projectMilestoneId`: The milestone ID for this task's phase (from Step 6)
- `priority`: Mapped from document (P0=1, P1=2, P2=3, P3=4)
- `labelIds`: Label IDs from Step 4 (only labels from `labels.yaml`)
- `stateId`: The "Backlog"/"Todo" state from Step 3
- `description`: Full markdown description including acceptance criteria, steps, files to modify, and dependencies listed as text

**Issue creation pattern using Python:**

```python
import json, subprocess, os

api_key = os.environ['LINEAR_API_KEY']

tasks = [
    # ... list of parsed tasks with all fields ...
]

query = 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }'

results = []
for task in tasks:
    variables = {
        'input': {
            'title': f"[{task['id']}] {task['title']}",
            'teamId': 'TEAM_ID',
            'projectId': 'PROJECT_ID',
            'projectMilestoneId': 'MILESTONE_ID',
            'priority': task['priority_num'],
            'labelIds': task['label_ids'],
            'stateId': 'STATE_ID',
            'description': task['description'],
        }
    }
    payload = json.dumps({'query': query, 'variables': variables})
    result = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.linear.app/graphql',
        '-H', 'Content-Type: application/json',
        '-H', f'Authorization: {api_key}',
        '-d', payload], capture_output=True, text=True)
    data = json.loads(result.stdout)
    issue = data.get('data', {}).get('issueCreate', {}).get('issue', {})
    results.append(issue)
    print(f"[{task['id']}] {issue.get('identifier', 'FAILED')} - {issue.get('title', 'FAILED')}")
```

This approach:
- Handles all special characters safely (quotes, backticks, parentheses, em dashes, etc.)
- Uses `json.dumps()` for proper escaping of the entire payload
- Provides clear per-issue success/failure feedback
- Is easy to retry individual failures

### Step 9: Report Results

After all issues are created, present a summary table to the user showing:

| Task ID | Linear ID | Title | Priority | Phase | Milestone | URL |
|---------|-----------|-------|----------|-------|-----------|---|

Include:
- Total number of issues created
- Total number of milestones created
- Total number of project documents created (one per ADR)
- Project URL with milestones view

Also provide a milestone summary:

| Milestone | Phase | Issue Count |
|-----------|-------|-------------|
| Phase 1: Setup | 1 | 5 |
| Phase 2: Implementation | 2 | 12 |

And a documents summary:

| Document Title | ADR File | URL |
|----------------|----------|-----|
| ADR title here | filename.md | https://... |

## Issue Description Template

For each issue description, use this markdown structure:

```markdown
**Phase:** [Phase number and name]
**Type:** [Backend/Frontend/DevOps/QA/Docs]
**Estimate:** [Time estimate from document]
**Repo:** [Repository name if specified]

## Description
[Main task description from the document]

## Steps
[Numbered steps if provided]

## Acceptance Criteria
[Acceptance criteria from the document]

## Dependencies
[List of dependency task IDs and titles, e.g., "Depends on: [1.2] Add config to API, [1.3] Create service class"]
```

## Error Handling

- If an issue creation fails, log the error and continue with the remaining issues
- If the API returns rate limit errors (429), wait 2 seconds and retry
- Log any failed issue creations and report them at the end
- If the LINEAR_API_KEY is not set or invalid, stop immediately and tell the user

## Tips

- Always verify the API key works by running the teams query first
- Use `python3 -m json.tool` to pretty-print API responses for debugging
- Use `jq` if available for extracting IDs from responses
- The Linear API returns UUIDs for all entity IDs -- these are needed for cross-references
- Milestones provide visual organization in Linear's project view and help track progress by phase
- You can query existing milestones for a project to avoid duplicates: `{ project(id: "PROJECT_ID") { projectMilestones { nodes { id name } } } }`
- Always use Python `json.dumps()` for payloads containing user-generated text (titles, descriptions) -- never try to manually escape quotes in inline GraphQL strings

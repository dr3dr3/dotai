````markdown
# PR Summary

Generate a pull request title and description for the current branch's changes, following project conventions.

## Instructions

1. Read the diff of the current branch against `main` (or `develop` if that is your integration branch)
2. Identify the affected modules or areas
3. Generate a PR using the structure below

## Output format

```
### Title
<type>(<scope>): <short imperative description>

Where type is one of: feat, fix, refactor, test, chore, docs, perf
Where scope is the module or area affected (e.g. auth, payments, user-profile)

### Description

## What

[1-3 sentences describing what this PR does in plain language. Focus on behaviour, not implementation.]

## Why

[1-2 sentences on the motivation — what problem this solves or why this change is needed.]

## Changes

- [Module/file]: [what changed]
- [Module/file]: [what changed]

## Testing

[Describe how this was tested — manual steps, automated tests added, or why testing is not applicable.]

## Checklist

- [ ] Business logic is in the correct layer (not in controllers/handlers)
- [ ] No hard-coded IDs, secrets, or environment-specific values
- [ ] Domain terminology from `context/domain-language.md` used correctly
- [ ] Code formatter has been run
- [ ] No debug statements (`console.log`, `dd()`, `debugger`, etc.) left in
- [ ] `.env.example` / config documentation updated if new environment variables added
- [ ] Relevant ADR consulted if working in an ADR-covered area
```

## Notes

- The title must follow conventional commits format
- Use the project's domain terminology — refer to `context/domain-language.md`
- If this is a security-sensitive change (auth, payments, data isolation), flag it explicitly in the description
- [FILL IN: Any other project-specific PR notes]
````

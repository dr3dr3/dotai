# run-this — André's AWS SSO profiles

Verified live 2026-09-14 by resolving every profile with `sts get-caller-identity`.
Source of truth is `~/.aws/config` (generated 2026-06-18 from the live SSO role
assignments); this page is the map for choosing a profile, not a copy of it.

One SSO session covers everything:
`aws sso login --sso-session rockofeye --use-device-code --no-browser`. **`--use-device-code --no-browser`
is not optional in the devcontainer.** AWS CLI ≥ 2.22 defaults to a PKCE flow
that starts a listener on `127.0.0.1:<random>` *inside the container* and
expects the browser to redirect there; his browser is on the Mac host, so it
dead-ends on a raw `…/oauth/callback?code=…` URL (seen 2026-09-14). Device
code prints a URL + short code that works from any browser.

**`--no-browser` is equally non-optional.** Without it the CLI "opens your
default browser", which in the devcontainer resolves to `www-browser` → lynx,
a text browser. Python's `webbrowser` runs console browsers in the foreground
and *waits for them to exit*, so the CLI sits behind a lynx screen in the pane
and never polls for the approval André already gave on the Mac. Every zombie
`[www-browser] <defunct>` on the box is a previous login that hit this. If a
pane is stuck that way: `q` then `y` quits lynx and the login completes. Token lifetime is short — check
`scripts/aws-session.sh` before starting anything that takes more than a few
minutes.

## Accounts and regions — the split that bites

| Account | Id | Where the resources are |
|---|---|---|
| Production ("Wil Valor") | 161832008940 | **us-west-2** (EB, SSM) |
| Staging | 470999030017 | **ap-southeast-2** (SSM, preview infra) |
| Sandbox | 563683519783 | ap-southeast-2 |
| Management | 956322717270 | ap-southeast-2 (Identity Center) |

**Every profile defaults to `region = ap-southeast-2`, but prod lives in
`us-west-2`.** A prod call without `--region us-west-2` returns an empty result
with exit 0 — it looks exactly like "nothing there". Always pass `--region`
explicitly on prod. (Staging is the mirror image: its SSM is in
ap-southeast-2, and querying us-west-2 comes back empty.)

## Profiles — pick the least role that answers the question

| Need | Profile | Role | Notes |
|---|---|---|---|
| Read anything in prod | `roe-prod` | AuditorAccess | **Default for prod.** Read-only by design. Same as `roe-prod-audit`. |
| Change prod | `roe-prod-admin` | AdministratorAccess | Only on an explicit ask; André runs it, not Claude. |
| Prod platform ops | `roe-prod-platform` | PlatformEngineerAccess | Cannot list SSM — use the auditor for reads. |
| Read staging | `roe-staging-audit` | AuditorAccess | The staging read default. |
| Staging dev (aurora pulls) | `roe-staging` | DeveloperAccess | What `make aurora-*` uses. **Cannot** `ssm:DescribeParameters`. |
| Staging admin / platform / ns-admin | `roe-staging-admin` / `-platform` / `-ns-admin` | as named | Platform and dev roles are denied SSM listing; auditor and admin are not. |
| Break-glass tenant data pull | `roe-staging-break-glass` | BreakGlassDataPull | **Inert** until `make break-glass-grant` (ADR-039). `ForbiddenException` here is expected, not a login problem. |
| Sandbox | `roe-sandbox` (dev) / `-admin` / `-platform` / `-ns-admin` / `-audit` | as named | |
| Management | `roe-management` = `roe-mgmt-admin` | AdministratorAccess | Identity Center, org. |

Short aliases kept for the Makefile/scripts: `roe-staging`, `roe-sandbox`,
`roe-management`, `roe-prod` (auditor — read-only).

## What's there (so probes ask the right question)

**Prod SSM (us-west-2)** — three parameters, each a whole `.env`:
`roe-api-prod-env`, `roe-sso-prod-env`, `roe-pms-core-prod-env` (plus an AWS
Inspector path). Never fetch a value into a log; `grep -c '^KEY='` on it for a
yes/no, or `describe-parameters` for `LastModifiedDate`/`Version` to answer
"did it change".

**Prod Elastic Beanstalk (us-west-2)**: `Api-rock-of-eye-ai-production-env`,
`sso-rock-of-eye-ai-production-env`, `roe-pms-core-prod`, `roe-pms-core-worker-prod`.

**Staging SSM (ap-southeast-2)**: `/roe/preview/*` (preview-box infra) and the
`roe-*-stg-env` blobs.

## The decision rule

1. `bash ~/.claude/skills/run-this/scripts/aws-session.sh [profile]`
2. **Live + read-only** (describe/list/get on auditor or dev) → **Claude runs it
   with Bash.** No block. Auditor roles can't write, so the blast radius is nil.
3. **Expired** → one block: `aws sso login --sso-session rockofeye --use-device-code --no-browser`
   (interactive device code — never `--quiet`; not `make aws-login`, which
   the runtime guard refuses unless it's on the READ list). Then back to 2.
4. **Any write on prod, or anything on `roe-prod-admin`** → a block, with the
   one-line reason above it, and André runs it. Claude does not run these even
   when the session is live.

# Fargate deploy

The thin, optional cloud layer. Same OCI image as local; orchestration is plain
aws-cli + a JSON task definition — **no Terraform** for this v1 foundation (documented
upgrade path when this goes shared/multi-tenant).

## Shape

One **task**, two containers sharing a network namespace:

```
ECS Fargate task (private subnet, no public IP)
├── egress   Squid allowlist proxy (essential, healthchecked)
└── agent    the substrate image (dependsOn egress HEALTHY)
                 HTTPS_PROXY=http://localhost:3128
```

- **Secrets** come from Secrets Manager (`/roe/sandbox/*`), injected by ECS into the
  agent container's **setup phase** as env, then dropped at the SETUP→AGENT boundary
  (`env -i` in [../entrypoint.sh](../entrypoint.sh)).
- **Logs/audit** → CloudWatch `/roe/sandbox` (stdout) and `/roe/sandbox/audit`
  (structured, via [../lib/audit.mjs](../lib/audit.mjs)).

## The load-bearing control: two IAM roles

| Role | Used by | Can it read secrets? |
|------|---------|----------------------|
| [`execution-role`](iam/execution-role.json) | ECS, at task **start** | ✅ only `/roe/sandbox/*` (to inject them) |
| [`task-role`](iam/task-role.json) | the **running agent** | ❌ no — only `logs:PutLogEvents` + `sts:GetCallerIdentity` |

So even though the task *starts* with secrets, the running agent's own AWS identity
cannot fetch them. Verify this (step 7 below) — it's the proof the split works.

## First-time setup

```bash
# 1. Standing infra: ECR repos, log groups, IAM roles
bash sandbox/deploy/bootstrap.sh

# 2. Read-only secrets into Secrets Manager (names must match task-definition.json)
aws secretsmanager create-secret --name /roe/sandbox/github-ro  --secret-string <token>
aws secretsmanager create-secret --name /roe/sandbox/sentry-ro  --secret-string <token>
aws secretsmanager create-secret --name /roe/sandbox/linear-ro  --secret-string <token>
aws secretsmanager create-secret --name /roe/sandbox/slack-ro   --secret-string <token>
aws secretsmanager create-secret --name /roe/sandbox/agentmail  --secret-string <token>

# 3. Build + push images
bash sandbox/image/build.sh
aws ecr get-login-password | docker login --username AWS --password-stdin \
  "$(aws sts get-caller-identity --query Account --output text)".dkr.ecr.ap-southeast-2.amazonaws.com
# docker tag roe-sandbox-agent:latest  <registry>/roe-sandbox-agent:latest  && docker push ...
# docker tag roe-sandbox-egress:latest <registry>/roe-sandbox-egress:latest && docker push ...
```

## Run a task

```bash
bash sandbox/deploy/run.sh \
  --subnets subnet-aaa,subnet-bbb \
  --security-groups sg-ccc \
  --profile claude-code \
  --operator andre.dreyer        # attribution in the audit trail
```

Use a **private subnet** with NAT for egress and a security group that allows only
outbound 443 (the proxy is the only thing that leaves; the agent has no other route).
No inbound is needed — this is a batch task.

## Verify

```bash
aws logs tail /roe/sandbox --follow              # setup → boundary → agent
aws logs tail /roe/sandbox/audit --follow        # structured audit, attributed to --operator
```

Confirm the role split (run inside the agent phase, e.g. via an exec/debug task):
`aws secretsmanager get-secret-value --secret-id /roe/sandbox/github-ro` → **AccessDenied**.

## Notes

- `task-definition.json` targets **ARM64** (cheaper); build images on arm64 or change
  `runtimePlatform`.
- Fargate has no `tmpfs` — the RO-tokens file uses an ephemeral task volume mounted at
  `/run/sandbox`. Fargate ephemeral storage is encrypted at rest, so this is acceptable;
  locally we use real tmpfs.

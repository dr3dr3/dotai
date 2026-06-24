#!/usr/bin/env bash
# =============================================================================
# AI Sandbox — one-time AWS bootstrap (idempotent).
# =============================================================================
# Provisions the STANDING infra the sandbox task needs:
#   - ECR repos for the agent + egress images
#   - CloudWatch log group /roe/sandbox (+ the audit group /roe/sandbox/audit)
#   - IAM execution role (start the task, inject secrets) + task role (RO runtime)
#
# Plain aws-cli, no Terraform — this is a v1 foundation. When this becomes shared/
# multi-tenant, port to Terraform (documented upgrade path).
#
# Prereqs: aws-cli authenticated (SSO ok), jq. Run from anywhere.
#   bash sandbox/deploy/bootstrap.sh
# =============================================================================
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "account=$ACCOUNT_ID region=$REGION"

# ── ECR repos ────────────────────────────────────────────────────────────────
for repo in roe-sandbox-agent roe-sandbox-egress; do
  aws ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" --region "$REGION" \
         --image-scanning-configuration scanOnPush=true >/dev/null
  echo "  ✓ ecr: $repo"
done

# ── Log groups ───────────────────────────────────────────────────────────────
for grp in /roe/sandbox /roe/sandbox/audit; do
  aws logs create-log-group --log-group-name "$grp" --region "$REGION" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$grp" --retention-in-days 90 --region "$REGION" 2>/dev/null || true
  echo "  ✓ log group: $grp"
done

# ── IAM roles ────────────────────────────────────────────────────────────────
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

create_role() {  # create_role <name> <inline-policy-file> <policy-name>
  local name="$1" policy_file="$2" policy_name="$3"
  aws iam get-role --role-name "$name" >/dev/null 2>&1 \
    || aws iam create-role --role-name "$name" --assume-role-policy-document "$TRUST" >/dev/null
  # Strip our JSON "Comment" key (not valid in a policy doc) before attaching.
  local doc; doc="$(jq 'del(.Comment)' "$policy_file")"
  aws iam put-role-policy --role-name "$name" --policy-name "$policy_name" --policy-document "$doc"
  echo "  ✓ iam role: $name"
}

create_role roe-sandbox-execution "$HERE/iam/execution-role.json" sandbox-execution
create_role roe-sandbox-task      "$HERE/iam/task-role.json"      sandbox-task

echo ""
echo "✓ bootstrap complete. Next:"
echo "  1. Put RO secrets in Secrets Manager under /roe/sandbox/* (github-ro, sentry-ro, linear-ro, slack-ro, agentmail)"
echo "  2. Push images:   bash sandbox/image/build.sh && <docker tag/push to the ECR repos>"
echo "  3. Run a task:    bash sandbox/deploy/run.sh --subnets subnet-xxx --security-groups sg-xxx"

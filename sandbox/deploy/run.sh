#!/usr/bin/env bash
# =============================================================================
# AI Sandbox — register the task definition and run one Fargate task.
# =============================================================================
# Substitutes placeholders into task-definition.json, registers a new revision,
# and runs it in the given private subnet(s)/security group. Pass --operator so the
# audit trail attributes the run to a human (on Fargate, STS only yields a role ARN).
#
#   bash sandbox/deploy/run.sh \
#     --subnets subnet-aaa,subnet-bbb \
#     --security-groups sg-ccc \
#     --profile claude-code \
#     --operator andre.dreyer
#
# Prereqs: bootstrap.sh run; images built + pushed to ECR; secrets in Secrets Manager.
# =============================================================================
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
CLUSTER="${SANDBOX_CLUSTER:-roe-sandbox}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBNETS="" SGS="" PROFILE="claude-code" OPERATOR="${USER:-unknown}"
while [ $# -gt 0 ]; do
  case "$1" in
    --subnets) SUBNETS="$2"; shift 2 ;;
    --security-groups) SGS="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --operator) OPERATOR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -z "$SUBNETS" ] || [ -z "$SGS" ] && { echo "✖ --subnets and --security-groups are required" >&2; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_AGENT="${IMAGE_AGENT:-$REGISTRY/roe-sandbox-agent:latest}"
IMAGE_EGRESS="${IMAGE_EGRESS:-$REGISTRY/roe-sandbox-egress:latest}"

# Ensure the cluster exists (cheap, idempotent).
aws ecs describe-clusters --clusters "$CLUSTER" --region "$REGION" \
  --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE \
  || aws ecs create-cluster --cluster-name "$CLUSTER" --region "$REGION" >/dev/null

# Substitute placeholders → register a new task-def revision.
TASKDEF="$(sed \
  -e "s|ACCOUNT_ID|${ACCOUNT_ID}|g" \
  -e "s|IMAGE_AGENT|${IMAGE_AGENT//|/\\|}|g" \
  -e "s|IMAGE_EGRESS|${IMAGE_EGRESS//|/\\|}|g" \
  "$HERE/task-definition.json" | jq "del(._comment) | (.containerDefinitions[] | select(.name==\"agent\") | .environment) |= map(if .name==\"SANDBOX_PROFILE\" then {name,value:\"$PROFILE\"} else . end) + [{name:\"SANDBOX_OPERATOR\",value:\"$OPERATOR\"}]")"

ARN="$(aws ecs register-task-definition --cli-input-json "$TASKDEF" --region "$REGION" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
echo "  ✓ registered $ARN"

# Run it (private subnet, no public IP — egress only via the proxy + NAT).
NET="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SGS],assignPublicIp=DISABLED}"
TASK="$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$ARN" \
  --launch-type FARGATE --network-configuration "$NET" --region "$REGION" \
  --query 'tasks[0].taskArn' --output text)"
echo "  ✓ started task $TASK"
echo ""
echo "Logs:  aws logs tail /roe/sandbox --follow --region $REGION"
echo "Audit: aws logs tail /roe/sandbox/audit --follow --region $REGION"

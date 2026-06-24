#!/usr/bin/env bash
# Build the AI Sandbox images. Self-contained — independent of .devcontainer/.
#   1. agent  — the substrate (tools + scripts + entrypoint), sandbox/image/Dockerfile
#   2. egress — the Squid allowlist proxy
#
# Run from anywhere:  bash sandbox/image/build.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

AGENT_TAG="${AGENT_TAG:-roe-sandbox-agent:latest}"
EGRESS_TAG="${EGRESS_TAG:-roe-sandbox-egress:latest}"

echo "── 1/2 agent image ($AGENT_TAG)"
# Context is the repo root because the image COPYs sandbox/ into /opt/sandbox.
docker build -t "$AGENT_TAG" -f sandbox/image/Dockerfile .

echo "── 2/2 egress proxy ($EGRESS_TAG)"
docker build -t "$EGRESS_TAG" -f sandbox/egress/Dockerfile sandbox/egress

echo "✓ built: $AGENT_TAG, $EGRESS_TAG"

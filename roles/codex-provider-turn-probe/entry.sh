#!/bin/sh
set -eu
test "$(stat -c %u:%g:%a /state)" = 0:0:711
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test ! -e /state/pilot/home/.codex/auth.json
test ! -e /state/pilot/home/.codex/config.toml
test -n "${ROE_PILOT_PROVIDER_TOKEN:-}"
test "$(sha256sum /state/pilot/contract.json | cut -d ' ' -f 1)" = "$ROE_CONTRACT_SHA256"
export HOME=/tmp/supervisor PATH=/usr/bin:/bin LANG=C
cd /state/pilot/work
exec /state/pilot/probe/nono run --profile /state/pilot/probe/profile.json --allow-cwd --no-rollback -- \
  /usr/bin/env HOME=/state/pilot/home CODEX_HOME=/state/pilot/home/.codex \
  XDG_CONFIG_HOME=/state/pilot/home/.config/roe-advisor \
  XDG_CACHE_HOME=/state/pilot/home/.cache/roe-advisor \
  XDG_STATE_HOME=/state/pilot/home/.local/state/roe-advisor \
  TMPDIR=/state/pilot/tmp \
  /state/pilot/probe/codex app-server --listen stdio:// \
  -c 'model_provider="roe_pilot_openai"' \
  -c 'model_providers.roe_pilot_openai.name="RoE pilot API project"' \
  -c 'model_providers.roe_pilot_openai.base_url="https://api.openai.com/v1"' \
  -c 'model_providers.roe_pilot_openai.env_key="ROE_PILOT_PROVIDER_TOKEN"' \
  -c 'model_providers.roe_pilot_openai.wire_api="responses"' \
  -c 'model_providers.roe_pilot_openai.requires_openai_auth=false' \
  -c 'model_providers.roe_pilot_openai.supports_websockets=false'

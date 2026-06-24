# Testing the AI Sandbox

Three tiers, increasing fidelity. Run Tier 0 anywhere; Tier 1 needs Docker; Tier 2
needs AWS. Each tier proves specific security properties — not just "it runs".

## Tier 0 — static + unit (no Docker)

```bash
bash sandbox/test/smoke.sh
```

Proves, in isolation and in seconds:

| Check | What it proves |
|-------|----------------|
| `bash -n`, `node --check`, JSON/YAML parse | nothing is syntactically broken |
| `audit.mjs` | writes a valid JSONL audit record |
| `redact.mjs` | scrubs literal env-secret values **and** credential patterns |
| **secret boundary** | the `env -i` boundary drops write creds, passes RO tokens + proxy |
| **setup phase** | emits a `0600` ro-tokens file with `GITHUB_TOKEN` excluded |
| `shellcheck` | (advisory, if installed) lint warnings |

Good for CI on every push — fast and dependency-light.

## Tier 1 — local integration (Docker, your OrbStack host)

```bash
bash sandbox/test/integration.sh            # builds images first
bash sandbox/test/integration.sh --no-build # reuse existing images
```

Builds the images and proves the **live** properties end-to-end:

| Test | What it proves |
|------|----------------|
| **A. no direct route** | the agent cannot reach the internet bypassing the proxy (topology, not just env) |
| **B. allowlist allows** | an allowlisted host (`api.github.com`) works through the proxy |
| **C. allowlist denies** | a non-allowlisted host (`example.com`) is blocked |
| **D. fail-closed** | with the proxy stopped, the agent has no egress at all |
| **E. full run** | a real clone → `env -i` boundary → agent self-test passes; working tree is read-only, `GITHUB_TOKEN` is gone, the RO token crossed |

Test E uses the **`selftest` profile** ([../profiles/selftest.env](../profiles/selftest.env)),
which execs [assert-agent-phase.sh](assert-agent-phase.sh) instead of a real harness —
so it verifies the box from the inside without needing Claude/Codex auth. It clones a
tiny public repo ([fixtures/repos.yaml](fixtures/repos.yaml)).

> Compose mounts the 1Password `agent.sock`. Have 1Password running, or comment that
> mount out of [../compose/docker-compose.yml](../compose/docker-compose.yml) on a
> credential-less box.

### Try a real harness manually

Once auth is wired (e.g. `ANTHROPIC_API_KEY` via varlock/`.env.local`):

```bash
# point repos.yaml at a real repo first, then:
SANDBOX_PROFILE=claude-code docker compose -f sandbox/compose/docker-compose.yml up
```

## Tier 2 — cloud (AWS Fargate)

After [../deploy/](../deploy/) `bootstrap.sh` + pushing images + secrets in Secrets
Manager:

```bash
bash sandbox/deploy/run.sh --subnets subnet-… --security-groups sg-… \
  --profile selftest --operator you
aws logs tail /roe/sandbox --follow            # setup → boundary → self-test
aws logs tail /roe/sandbox/audit --follow      # attributed to --operator
```

Checklist:

- [ ] Task reaches the agent phase; `selftest` prints `PASSED` in the logs.
- [ ] Audit stream in `/roe/sandbox/audit` is attributed to `--operator`.
- [ ] **Role-split proof** — exec into a running task (or a debug task) and run
      `aws secretsmanager get-secret-value --secret-id /roe/sandbox/github-ro` →
      **AccessDenied** (the task role cannot read secrets, even though the task
      *started* with them via the execution role).
- [ ] Egress: the task's security group only permits outbound 443 via the proxy.

## What the tests do NOT cover (known residual risk)

- **DNS-tunnel / SNI-spoof exfiltration** — the allowlist matches on host/SNI; closing
  this needs an SNI-strict or DNS-allowlisting resolver (documented upgrade path).
- **Graphify build correctness** — the exact CLI is unverified and the step is
  non-fatal; tests disable it (`SANDBOX_GRAPH_DISABLE=1`). Confirm the invocation
  against the version you install before relying on the graph.
- **Linear write-scope** — `LINEAR_TOKEN` is RO-by-convention; not enforced by a test.

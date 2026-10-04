# Firstmate registration brief: codex-provider-turn-probe

Lane: independent personal internal tooling. Register a **new** queued,
metadata-only, operator-only scout with `worker_dispatch=none` only after André
accepts the dedicated API-project credential path and the project has a
verified hard spend limit no greater than $50. Registration must not start a
worker, Docker, Codex, a model call or a reservation. Do not use a personal
OAuth store or the shared role state as a writable mount.

André has allowed pay-as-you-go pricing for this bounded trial but prefers
subscription-backed Codex and Claude for normal pilot use. This is an optional
one-off API-project diagnostic, not the default provider path. Assess the
subscription-auth route separately before choosing whether this paid probe is
needed. API-project acceptance cannot stand in for ChatGPT-plan OAuth
acceptance or Claude subscription adapter acceptance.

Source: `/workspace/.ai/dotai-codex-provider-turn`, branch
`feat/codex-provider-turn`. Verify committed HEAD, exact SHA-256 of `run.ts`
and `pins.json`, and `node run.ts --bundle-check` before registration. The
runner checks all its pinned sources; native Codex remains 0.157.1 ARM64 ELF
SHA-256 `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
The image is SHA-256
`786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`,
engine 29.4.0 / daa0cb7f / arm64, nono 0.76.0, pinned seccomp. No re-pin.

The registered runtime command, if separately authorized after review, is:

```text
roe-coordination run --home /workspace/.firstmate-home --task codex-provider-turn-probe -- node /workspace/.ai/dotai-codex-provider-turn/roles/codex-provider-turn-probe/run.ts --execute
```

The Operator pane must supply a temporary key from the isolated API project as
`ROE_PILOT_PROVIDER_TOKEN`, and attest `ROE_PILOT_PROJECT_CAP_USD=50` and
`ROE_PILOT_PROJECT_ISOLATED=yes`. Never put the key in the command line,
task metadata, transcript, git, or a shared HOME. The key is exposed to the
disposable Codex process and Docker inspect while the turn container exists;
the project limit and prompt revocation are required. The captain must review
the project's actual hard limit, current usage, model restriction, data
suitability, and key scope before setting the attestation. The runner cannot
verify those account settings by itself.

The runner creates one disposable volume, copies the installed
`roe-role-pilot-state-v1` read-only into it, and starts four setup containers
with `--network=none`. Only the one-turn container uses `--network=bridge`,
under nono's `api.openai.com` domain allowlist. No host workspace, shared HOME,
Docker/Herdr socket or role instruction directory is mounted. All containers
use the reviewed image, zero capabilities, no-new-privileges, pinned seccomp,
read-only root filesystem and resource/time limits. The turn uses
`gpt-6-luna`, Responses API, exactly one synthetic marker request, and rejects
tool activity. No real project content is sent.

Acceptance requires a completed turn with exact marker output, clean process
exit, exact credentialed-container removal, clone removal, installed-volume
preservation, a complete captured Operator log ending `DONE rc=0`, and a fresh
`roe-coordination status` showing available. On failure, remove the exact
credentialed container, revoke the temporary key, retain the private clone as
potentially sensitive with the reservation, and reconcile through Firstmate
before retrying. If
the credentialed container cannot be removed, the captain must immediately
revoke the key before further work. Never bypass a refusal.

This accepts only Codex API-project authentication and one bounded inference
turn. Native transcript resume, container persistence, Herdr restore, Claude
and Pi adapter acceptance, and role activation remain separate and disabled.

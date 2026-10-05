# Proposed Codex single-turn persistence probe — source review, not execution

Prepared 2026-09-30 in the personal independent tooling lane. This directory
contains an offline protocol contract and fake-message tests only. It has **no
runner, credential reader, Docker call or launch entry point**. The existing
registered `nono-session-probe` explicitly forbids inference; it cannot be used
for this proposal. André has chosen subscription login and authorised investigation;
the exact mount, provider endpoint, model and new Firstmate task remain unverified.

## Why this is the next experiment

The captain's 2026-09-29 no-turn capture initialized pinned Codex 0.157.0,
created and named a non-ephemeral thread, then found no persisted rollout after
the first process exited. It stopped before resume. The same no-turn fixture
cannot establish process persistence by repetition. The proxy startup websocket
reported HTTP CONNECT 502, but that observation does not establish the cause of
the absent rollout.

Official [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server)
defines `turn/start`, `turn/completed` and exact-ID `thread/resume`. A completed
turn, rather than thread creation alone, is the smallest useful persistence
checkpoint. The [OpenAI app-server usage guide](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
says only `turn.status=completed` is a successful inference result. The local
0.157.0 schema, not the current web example, controls exact wire fields:

| Local generated schema | SHA-256 |
|---|---|
| `v2/TurnStartParams.json` | `2dfcf68705896fadc344ccfeb2e9fe5a6bcbbb8b9a90cf449ce232b636daf05a` |
| `v2/TurnCompletedNotification.json` | `20052f79e907069a0d7948b93ba0927fa08f9a2faac23a63a0e8e527ae6bf0f7` |
| `v2/AgentMessageDeltaNotification.json` | `996e6c0ea65e57bed5a00f410b94381fe5ebf804333e5d00c2b6e6d47e5c55f6` |
| `v2/ThreadResumeParams.json` | `c818e26d830ac4430791eab7d4a872d2384fa6006b14c505d8caf46e7e093527` |

`protocol.py` builds one `turn/start` on an exact recorded thread ID, with one
synthetic request for `ROE_PERSISTENCE_PROBE_OK`. It requires a reviewed model
name, rejects server requests and observed tool items, bounds the reply, and
accepts only a matching `turn/completed` with status `completed` and the exact
marker. Five offline tests cover success, failure/interruption, identity mismatch,
missing/wrong reply and tool/request refusal. This is a protocol contract, not a
claim that prompt wording prevents tool execution. The outer nono/container
boundary must protect the host even if a model ignores the request.

## Proposed captain-only sequence after separate authorization

1. Register a **new** operator-only Firstmate task with exact inputs, provider,
   model, maximum requests, spend and cleanup. Firstmate coordinates only; André
   runs the capture from his own shell. Check `roe-coordination status` first.
2. Review provider egress with no credential: the selected endpoint must succeed
   through the intended nono proxy, while an unlisted endpoint and direct TCP
   remain denied. Prior example.com success does not prove provider access. Do
   not treat a proxy CONNECT response as successful inference.
3. Provide one reviewed credential route without streaming personal `auth.json`
   in the container tar, mounting full HOME or logging token material. Bound its
   read scope and refresh/lifetime. Stop if that route cannot be demonstrated.
4. Use the pinned native Codex executable in one disposable isolated container:
   non-root user, no app/workspace/Herdr/Docker mounts, synthetic context only,
   all capabilities dropped, read-only root, bounded private tmp/state and
   output, existing reviewed seccomp policy, resource/time ceilings, and no
   broadened child file grants. The provider endpoint is the only intended
   outbound destination. Select one reviewed model before execution.
5. Initialize app-server; start one non-ephemeral thread; record its returned ID;
   name it; send the single synthetic `turn/start`. Capture the matching turn ID.
   Stop on any server request, observed tool item, failed/interrupted turn,
   unexpected content or timeout. No approval response, retry, second turn, tool
   output, real data, or fallback provider.
6. Require a local rollout and clean first-process exit. Start a second app-server
   process in the **same disposable container/state**, `thread/read` and
   `thread/resume` the exact recorded ID, and verify name plus the completed turn
   under that ID. Stop and retain diagnostic evidence on mismatch. Capture
   container state and bounded logs, then verify exact-container cleanup.

This proves at most local process restart within one container. Container
recreation, persistent volume transport, Herdr native restoration, real roles,
Concierge integration and feedback remain separate gates.

## Decisions required before a runnable probe exists

- **Credential route:** the current fixture has no credentials, and the accepted
  environment plan forbids copying personal OAuth files into streamed artifacts.
  The candidate role adapter uses a read-only auth link, but the dedicated
  container needs a reviewed exact source mapping and refresh behavior. No
  credential content has been inspected here. The preferred candidate is
  one exact read-only credential-file mount, with renewal outside the child;
  that is a **new grant** requiring explicit review. If an exact host source
  cannot be resolved safely, stop instead of mounting HOME or copying the file.
- **Provider egress:** the current fixture uses `--network=none` and logged
  proxy HTTP CONNECT 502 for a startup websocket. A model turn needs reviewed
  outbound networking with the nono provider-domain filter and direct-TCP denial.
  The earlier network acceptance covered example.com, not api.openai.com.
- **Model and allowance:** select the exact model/provider and one-turn cost or
  spend ceiling. No default or current model is inferred from this devcontainer.
- **Tool prevention:** a prompt and client notification rejection detect unwanted
  tool activity but do not prevent a built-in tool from starting. The final
  runner must prove the outer filesystem/network boundary before a credentialed
  turn and treat any tool activity as a failed trial.

Do not issue an execution command until these choices are reviewed, encoded in
a new registered task and verified against the final runner. Leave the current
`roe-role` activation blocker in place.

## Subscription-login volume investigation — 2026-09-30

André approved investigating the existing authenticated volume and using his
Claude/Codex subscription logins for a bounded trial. The devcontainer Compose
source mounts `roe-devcontainer-ai` at `/home/vscode/.ai`; actual mount metadata
confirms that path is mounted. `~/.codex` links to `.ai/codex`, and `~/.claude`
links to `.ai/claude`. The Codex auth file and Claude credential file both exist
with mode 0600. `codex login status` reports **Logged in using ChatGPT**;
`claude auth status --text` reports **Claude Max account**. This shell has no
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY` override present. These status commands
do not prove that a newly isolated child can refresh or use either login.

Docker documents `volume-subpath` for an existing portion of a named volume and
read-only mounting. A Codex candidate is a read-only mount of only the existing
`codex/auth.json` subpath, with child-local writable Codex state; **do not mount
the whole AI volume or copy credential content into the streamed tar**. The
exact Docker volume name, file-subpath behavior on the pinned engine, destination
path, nono file grant and refresh failure behavior need an inert captain-run
preflight before any authenticated turn. Any auth refresh failure stops the
trial. Claude requires its own adapter and path review; its login presence is
not Codex probe acceptance. Subscription use must refuse API-key fallback and
any prompt to switch to paid API credits.

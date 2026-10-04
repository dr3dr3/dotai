# Operator preflight: isolated OpenAI API project

This is a human review in the API Platform before any Firstmate task is
registered. It is not a request for a key in chat, a PR or a saved transcript.
The ai-pilot pane owns the decision and result; AI-Think only routes it.

1. Select a **separate nonproduction project** for this one synthetic Codex
   turn. Confirm it has no other users, keys or workloads that could draw on
   the same project threshold. Record its nonsecret project ID/name.
2. In **Project settings → Limits → Spend**, set the monthly threshold to
   **$40 USD**, turn on **Enforce a hard limit**, save, then reopen the setting
   and confirm both values persisted. A notification threshold alone does not
   stop traffic. OpenAI says enforcement can lag and recorded spend may
   slightly exceed $40; this is a buffer under the $50 trial budget, not an
   absolute ceiling.
3. In project **Usage**, record current monthly spend and its timestamp in
   UTC. A new isolated project should show $0.00; any nonzero or unavailable
   reading needs review before running.
4. In project **Model Usage**, confirm `gpt-6-luna` is allowed. Confirm the
   project is permitted to use the Responses API and the synthetic marker
   contains no real project data. A model catalogue entry alone is not proof
   of account entitlement; the completed turn is the final access test.
5. Create a temporary restricted **project-scoped** key only when the
   Operator run is ready. Keep the value in the Operator terminal; do not
   paste it into chat, GitHub, request metadata, scripts, or a shared HOME.
   Revoke it promptly after the one-turn run, including on refusal.

Return only these nonsecret facts to the ai-pilot pane: project ID/name,
`hard_enforcement=on`, `threshold_usd=40`, current usage and UTC time,
`gpt-6-luna=allowed`, and whether a temporary restricted key can be issued.
Do not return the key or a screenshot containing it. If any field cannot be
verified, stop before task registration.

Source: https://developers.openai.com/api/docs/guides/spend-limits

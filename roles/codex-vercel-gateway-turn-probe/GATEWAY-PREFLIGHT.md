# Operator preflight: one Vercel AI Gateway Codex turn

Lane: independent personal internal tooling. This is a human account check,
not a credential request in chat. André reported a $7 Gateway credit balance
and `openai/gpt-6-luna` visible on 2026-10-04; neither was independently
verified by this fixture. Recheck immediately before any task registration.

1. Select the intended Vercel team and confirm its current AI Gateway credit
   balance is at least $1, with a UTC timestamp. Confirm `openai/gpt-6-luna`
   is usable for that team, including its current credit tier. A catalogue
   listing alone does not prove request entitlement.
2. Confirm AI Gateway **auto top-up is off**. Do not add a payment method or
   purchase credits for this gate. Confirm the request will use Gateway
   credits, without a bring-your-own-provider-key route.
3. When the captured Operator run is ready, create **one dedicated Gateway API
   key** named for this pilot test. At creation, set an **API key budget of $1
   USD with refresh period `none`**; verify the saved key row displays that
   budget and $0 spent. A Vercel project budget does not cover an API-key
   request. Never use an existing shared key. Keep the secret value only in
   the Operator terminal, and revoke it after the one-turn result or refusal.
4. Confirm the synthetic marker is the only prompt and contains no real
   project content. The role receives no shared HOME/workspace mount or host
   socket. Do not enable `roe-role run` or any other role launch.

Vercel checks a key budget before each request; the request that crosses it
may finish above $1. Auto top-up is a separate account control. Neither the
runner nor its environment attestations can independently read these Vercel
settings. Do not register or run the task if any setting is unavailable or
unexpected. Return only the team name, timestamped balance, model
availability, `auto_topup=off`, and whether a dedicated nonresetting $1 key
budget can be created. Never return the key or a screenshot containing it.

Sources:
- https://vercel.com/docs/ai-gateway/pricing
- https://vercel.com/docs/ai-gateway/observability-and-spend/budgets
- https://vercel.com/ai-gateway/models/gpt-6-luna

# Egress proxy

A [Squid](http://www.squid-cache.org/) proxy that enforces a **deny-by-default domain
allowlist**. It is the keystone control of the sandbox: the agent container has no
direct internet route, so the *only* way out is through this proxy, and the proxy only
permits the hosts in [allowlist.conf](allowlist.conf).

## How traffic is forced through it

The proxy env alone (`HTTPS_PROXY`) is a convenience, not a control — a process can
ignore it. So we also remove the direct route:

- **Local** ([../compose/docker-compose.yml](../compose/docker-compose.yml)): the agent
  is on an `internal: true` Docker network (no gateway to the internet) plus a second
  network shared only with this proxy. Its sole egress path is the proxy.
- **Fargate** ([../deploy/](../deploy/)): agent + proxy share one task (same network
  namespace, so the agent uses `http://localhost:3128`). The task sits in a private
  subnet; the security group + NAT mean the proxy is the only thing that can leave.

## Editing the allowlist

Edit [allowlist.conf](allowlist.conf) — one host per line, `.example.com` matches
subdomains. **Treat additions like firewall changes.** Every host widens leg 3 of the
lethal trifecta (external communication). After editing:

- local: restart the `egress` compose service
- Fargate: register a new task definition revision (the file is baked into the image)

## What it does NOT do (no TLS interception)

For HTTPS the client sends `CONNECT host:443`; Squid allows/denies on the **host**, then
tunnels the encrypted bytes without decrypting. So:

- ✅ Squid never sees plaintext — no CA to distribute, no plaintext-secret exposure.
- ✅ Host allowlisting survives CDN IP churn (it's name-based, not IP-based).
- ⚠️ **Residual risk (accepted for v1):** matching is on the requested host/SNI, so a
  client could in principle domain-front or tunnel data via DNS lookups to an allowed
  resolver. Closing these requires SNI-strict filtering / a DNS-allowlisting resolver —
  the documented upgrade path, not built now.

## Fail-closed

The image has a `HEALTHCHECK`. Locally, the agent has no route at all if the proxy is
down. On Fargate the proxy container is `essential` and the agent `dependsOn` it being
`HEALTHY` — a dead proxy never silently opens direct egress.

## Verifying

From inside the agent container (proxy env already set):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://api.github.com   # allowlisted → 200/403
curl -sS https://example.com                                       # NOT allowed → 403 from Squid
```

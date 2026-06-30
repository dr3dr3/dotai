# Egress proxy image — Squid with our deny-by-default allowlist baked in.
# Multi-arch (amd64/arm64) via the ubuntu base, matching the agent image.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

# squid + curl (curl is only for the HEALTHCHECK).
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends squid curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Our config + policy. allowlist.conf is referenced by squid.conf.
COPY squid.conf /etc/squid/squid.conf
COPY allowlist.conf /etc/squid/allowlist.conf

# Run unprivileged. Squid 6 refuses to run as root; starting the container as the
# 'proxy' user also makes the container's /dev/stdout|stderr proxy-owned, so
# Squid's stdio logs open cleanly (no "Cannot open '/dev/stdout'"). Ensure its
# runtime dirs are writable by that user.
RUN chown -R proxy:proxy /var/log/squid /var/spool/squid /etc/squid
USER proxy

EXPOSE 3128

# Fail-closed signal: if Squid isn't serving, the healthcheck fails and the
# orchestrator (compose dependsOn / ECS dependsOn) refuses to start the agent.
#
# Liveness, NOT a successful fetch: we ask the proxy for a host that is
# deliberately NOT on the allowlist (.invalid is reserved, RFC 6761, so it can
# never be allowlisted). A live gate answers with a real HTTP status — 403,
# since deny-by-default rejects it — which proves Squid is up AND enforcing.
# If Squid is down, curl can't reach the proxy and prints "000" → unhealthy.
# (Do NOT use `curl -f` here: it treats the expected 403 as a failure, which
# would leave the gate permanently unhealthy even though it's working.)
HEALTHCHECK --interval=5s --timeout=3s --retries=5 --start-period=5s \
    CMD curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 \
        --proxy http://127.0.0.1:3128 http://healthcheck.invalid/ \
        | grep -qE '^[1-5][0-9][0-9]$'

# Run in the foreground (-N), log to console (-d 1), don't daemonize.
CMD ["squid", "-N", "-d", "1", "-f", "/etc/squid/squid.conf"]

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

EXPOSE 3128

# Fail-closed signal: if Squid isn't serving, the healthcheck fails and the
# orchestrator (compose dependsOn / ECS dependsOn) refuses to start the agent.
HEALTHCHECK --interval=5s --timeout=3s --retries=5 --start-period=5s \
    CMD curl -fsS --proxy http://localhost:3128 -o /dev/null \
        --connect-timeout 2 http://localhost:3128 || exit 1

# Run in the foreground (-N), log to console (-d 1), don't daemonize.
CMD ["squid", "-N", "-d", "1", "-f", "/etc/squid/squid.conf"]

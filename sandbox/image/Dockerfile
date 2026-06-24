# AI Sandbox agent image — fully self-contained.
#
# Independent of .devcontainer/ (which is the general-purpose interactive dev setup).
# This image is purpose-built for running autonomous agents locally or on Fargate.
# It intentionally mirrors the devcontainer's hardening approach (Ubuntu 24.04,
# signed keyrings, pinned versions, non-root user) but is its own thing — edit this
# file to change the sandbox; the devcontainer is untouched.
#
# Build:  bash sandbox/image/build.sh   (or see compose/ and deploy/)
FROM ubuntu:24.04

LABEL maintainer="André Dreyer" \
      org.opencontainers.image.title="roe-sandbox-agent" \
      org.opencontainers.image.description="Hardened sandbox for autonomous AI agents"

ARG DEBIAN_FRONTEND=noninteractive

# ── Base deps + Node.js 22 (NodeSource, keyring-signed — no piped installer) ──
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        build-essential curl ca-certificates gnupg git unzip less sudo groff jq \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

# ── yq (pinned) — parses sandbox/repos.yaml in the setup phase ───────────────
ARG YQ_VERSION="v4.44.3"
RUN curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_$(dpkg --print-architecture)" \
        -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

# ── AWS CLI v2 — audit → CloudWatch, secret injection on Fargate ─────────────
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"; \
       elif [ "$ARCH" = "arm64" ]; then AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"; \
       else echo "Unsupported arch: $ARCH" && exit 1; fi \
    && curl -fsSL "$AWS_URL" -o awscliv2.zip && unzip -q awscliv2.zip && ./aws/install \
    && rm -rf awscliv2.zip aws

# ── Non-root user ────────────────────────────────────────────────────────────
ARG USERNAME=dev USER_UID=1000 USER_GID=1000
RUN userdel -r ubuntu 2>/dev/null || true \
    && groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME -s /bin/bash \
    && echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

USER $USERNAME
WORKDIR /home/$USERNAME
ENV PATH="/home/${USERNAME}/.local/bin:$PATH"

# ── Agent harnesses + secrets tooling + inner sandbox ────────────────────────
# Claude Code (official installer), Codex + varlock (npm), Pi (--ignore-scripts per
# vendor), and sandbox-runtime (inner fs/network confinement for harnesses without
# their own permission system, e.g. Pi — see sandbox/profiles/pi.env).
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN sudo npm install -g @openai/codex varlock && codex --version && varlock --version
RUN sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent && pi --version
RUN sudo npm install -g @anthropic-ai/sandbox-runtime && echo "sandbox-runtime installed"

# ── The substrate scripts + writable areas ───────────────────────────────────
COPY --chown=root:root sandbox /opt/sandbox
RUN sudo chmod -R a+rX /opt/sandbox \
    && sudo chmod a+rx /opt/sandbox/entrypoint.sh /opt/sandbox/phases/*.sh \
    && sudo mkdir -p /work /var/log/sandbox \
    && sudo chown -R $USERNAME:$USERNAME /work /var/log/sandbox

ENV SANDBOX_DIR=/opt/sandbox \
    SANDBOX_WORKDIR=/work/roe-codebase \
    SANDBOX_GRAPH_DIR=/work/.graph

ENTRYPOINT ["/opt/sandbox/entrypoint.sh"]

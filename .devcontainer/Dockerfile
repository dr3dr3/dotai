# Use Ubuntu Noble (24.04 LTS) for a lower CVE surface area than Debian Bookworm
FROM ubuntu:24.04

LABEL maintainer="André Dreyer"

# Avoid prompts from apt during build only (ARG scopes it to build time, not the running container)
ARG DEBIAN_FRONTEND=noninteractive

# Install base dependencies and Node.js 22 via NodeSource in a single layer
# apt-get upgrade ensures any base image CVEs are patched at build time.
# npm package CVEs (tar, minimatch, glob) are addressed by the npm install -g npm@latest step below.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    # Essential build tools
    build-essential \
    # Networking and download tools
    curl \
    ca-certificates \
    gnupg \
    # Version control
    git \
    # Useful utilities
    unzip \
    less \
    sudo \
    # Required for AWS CLI v2
    groff \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 via the official NodeSource apt repository.
# Using the keyring/sources.list approach avoids piping a remote script directly into bash,
# which removes the supply-chain risk of the setup_22.x installer method.
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Update npm to the latest version
RUN npm install -g npm@latest

# yq — YAML/JSON/TOML processor (useful for AI-assisted workflows and scripting)
# Not in Debian repos; install from GitHub releases (mikefarah/yq).
# Pinned to a specific version to avoid pulling an unverified 'latest' binary.
# To update: bump YQ_VERSION and verify checksums at https://github.com/mikefarah/yq/releases
ARG YQ_VERSION="v4.44.3"
RUN curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_$(dpkg --print-architecture)" \
    -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

# Install AWS CLI v2
# AWS CLI v2 is distributed as a pre-built binary package
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"; \
       elif [ "$ARCH" = "arm64" ]; then AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"; \
       else echo "Unsupported arch: $ARCH" && exit 1; fi \
    && curl -fsSL "$AWS_URL" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# GitHub CLI (gh) — PR/issue management and AI-assisted workflows
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && mkdir -p -m 755 /etc/apt/sources.list.d \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN echo "Verifying installations..." \
    && node --version \
    && npm --version \
    && yq --version \
    && aws --version \
    && gh --version
    
# Create a non-root user for development (following devcontainer best practices)
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN userdel -r ubuntu 2>/dev/null || true \
    && groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME -s /bin/bash \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Switch to non-root user
USER $USERNAME
WORKDIR /home/$USERNAME

# Configure git user
# Note: git config is also set via postCreateCommand in devcontainer.json at container start.
# The step here ensures git works correctly during the image build (e.g. for any RUN steps that use git).
RUN git config --global user.name "André Dreyer" && \
    git config --global user.email "github@andredreyer.com"

# Install Claude Code CLI using the official Anthropic native installer.
# This is the vendor-recommended install method: https://docs.anthropic.com/en/docs/claude-code/setup
# Note: npm installation is deprecated by Anthropic. Native installer auto-updates in background.
# Risk acknowledged: supply-chain trust is delegated to Anthropic's claude.ai domain.
# No checksummed or versioned alternative is currently provided by Anthropic.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add ~/.local/bin to PATH so the `claude` binary is accessible
ENV PATH="/home/${USERNAME}/.local/bin:$PATH"

# Secondary agents + secrets tooling (run in-container; the host stays agent-free):
#   - @openai/codex : OpenAI Codex CLI (secondary agent)
#   - varlock       : resolves op:// refs into env at launch, via the mounted
#                     1Password agent.sock (see devcontainer.json mounts/remoteEnv)
# Installed globally with sudo (npm's global prefix is root-owned; the dev user
# has passwordless sudo). Pin/September-audit these as needed.
RUN sudo npm install -g @openai/codex varlock \
    && codex --version && varlock --version

# Default command
CMD ["/bin/bash"]
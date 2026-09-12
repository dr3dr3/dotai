# Personal interactive shortcuts. Re-check at shell startup so host shells skip them.
if [ "${DEVCONTAINER:-}" = "1" ]; then
    alias cx='codex --sandbox danger-full-access --ask-for-approval on-request'
    alias cc='claude --permission-mode default --settings '\''{"sandbox":{"enabled":false}}'\'''
fi

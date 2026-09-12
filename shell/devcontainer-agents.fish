# dotai: devcontainer agent aliases
if set -q DEVCONTAINER; and test "$DEVCONTAINER" = 1
    function cx --wraps codex --description 'Codex without sandbox, approval on request'
        codex --sandbox danger-full-access --ask-for-approval on-request $argv
    end
    function cc --wraps claude --description 'Claude without sandbox, normal permissions'
        claude --permission-mode default --settings '{"sandbox":{"enabled":false}}' $argv
    end
end

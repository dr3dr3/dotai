#!/usr/bin/env bash
# Human-reviewed write operation. Copy to /workspace/tmp and fill every section.
# The operator inbox freezes this file and shows its SHA-256 before execution.
# A non-zero result stops the script; never retry a write whose outcome is unknown.
set -euo pipefail

printf 'target=%s\n' '<exact environment, resource and scope>'
printf 'change=%s\n' '<specific intended mutation>'

# Preconditions: print the current revision/state and fail if it differs from
# the reviewed expectation. Use an authoritative source, not a cached guess.
# Example: test "$(git -C /workspace/repos/target rev-parse HEAD)" = '<reviewed-sha>'

# Perform ONE bounded mutation through its existing approved command surface.
# For local shared runtime work, the operator request's local-runtime recipe
# wraps this whole script in roe-coordination run under an existing Firstmate task.
# For production data writes, use the purpose-built approved workflow instead.

# Read the postcondition from the authoritative surface. Print a sentinel that
# distinguishes success, no-op, and unknown. This must not assume exit 0 proves
# that a distributed operation completed.
printf 'outcome=not-implemented\n'
exit 2

#!/usr/bin/env bash
# Blocks edits to locked test suites unless .claude/tests-unlocked exists.
set -euo pipefail
file="$(jq -r '.tool_input.file_path // empty')"
case "$file" in
  */test/acceptance/*|*/test/concurrency/*)
    if [[ ! -f "$CLAUDE_PROJECT_DIR/.claude/tests-unlocked" ]]; then
      echo "Blocked: $file is a locked test. Explain why it should change and wait for approval." >&2
      exit 2
    fi
    ;;
esac
exit 0

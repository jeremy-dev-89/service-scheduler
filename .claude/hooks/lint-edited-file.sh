#!/usr/bin/env bash
# Lints the TypeScript file Claude just edited and feeds failures back to Claude.
set -uo pipefail
file="$(jq -r '.tool_input.file_path // empty')"
[[ "$file" == *.ts ]] || exit 0
cd "$CLAUDE_PROJECT_DIR"
if ! output="$(npx eslint --no-warn-ignored "$file" 2>&1)"; then
  printf 'ESLint failed for %s:\n%s\n' "$file" "$output" >&2
  exit 2
fi
exit 0

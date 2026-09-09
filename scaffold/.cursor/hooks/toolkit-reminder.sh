#!/usr/bin/env bash
# Cursor adapter — JSON response for beforeSubmitPrompt
set -euo pipefail
cat >/dev/null 2>&1 || true
msg=$(bash .project/harness/toolkit-reminder.sh 2>/dev/null | tr '\n' ' ' | sed 's/"/\\"/g')
printf '%s\n' "{\"permission\":\"allow\",\"agent_message\":\"${msg}\"}"

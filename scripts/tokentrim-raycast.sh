#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Optimize Prompt with TokenTrim
# @raycast.mode silent

# Optional parameters:
# @raycast.icon 🍋
# @raycast.packageName Developer Tools

# Documentation:
# @raycast.description Takes selected prompt text, enriches it via TokenTrim, and copies to clipboard.
# @raycast.author TokenTrim

SELECTED_TEXT=$(pbpaste)

if [ -z "$SELECTED_TEXT" ]; then
  echo "No text in clipboard!"
  exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
node "$DIR/../demo/watch.js" "$SELECTED_TEXT" --quiet

echo "Prompt optimized & copied to clipboard!"

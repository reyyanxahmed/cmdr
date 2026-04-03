#!/bin/bash
set -euo pipefail

# Both files must exist
[[ -f bundler.js ]] || exit 1
[[ -f cli.js ]] || exit 1

# Run the bundler on the sample entry
node cli.js src/index.js

# bundle.js must be produced
[[ -f bundle.js ]] || exit 1

# Running the bundle should produce correct output
OUTPUT=$(node bundle.js 2>&1)
echo "$OUTPUT" | grep -q "5" || exit 1
echo "$OUTPUT" | grep -q "Hello, World" || exit 1

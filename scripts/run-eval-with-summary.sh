#!/usr/bin/env bash
# Run promptfoo eval and then print result summary + recommendations to the terminal.
# Usage: ./scripts/run-eval-with-summary.sh   (from repo root)

set -e
cd "$(dirname "$0")/.."

TEST_FILE=$(ls -t .specalign/test_cases/*.yaml 2>/dev/null | head -1)
if [ -z "$TEST_FILE" ]; then
  echo "No test cases found. Run: specalign generate --model .specalign/models/default.yaml --count 50"
  exit 1
fi

echo "Running evaluation on: $TEST_FILE"
mkdir -p promptfoo-output

# Run eval and write JSON so we can generate summary (npx works without global install)
npx --yes promptfoo eval -c "$TEST_FILE" --output promptfoo-output/report.html --output promptfoo-output/results.json

# Generate SUMMARY.md (includes recommendations)
node scripts/generate-summary.js promptfoo-output/results.json "$TEST_FILE" promptfoo-output/SUMMARY.md

# Generate HTML analysis (tables, why tests failed, what to fix)
node scripts/generate-analysis-html.js promptfoo-output/results.json "$TEST_FILE" promptfoo-output/analysis.html

echo ""
echo "========== Result summary and recommendations =========="
cat promptfoo-output/SUMMARY.md
echo "========================================================="
echo ""
echo "Reports: promptfoo-output/report.html (interactive) | promptfoo-output/analysis.html (tables + fix tips) | promptfoo-output/SUMMARY.md"

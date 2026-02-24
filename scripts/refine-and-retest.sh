#!/usr/bin/env bash
# One-shot self-refine: extract failures, call LLM to refine assertions, patch YAML, re-run eval.
# Usage: ./scripts/refine-and-retest.sh   (from repo root)
# Requires: OPENAI_API_KEY, and promptfoo-output/results.json from a previous eval.

set -e
cd "$(dirname "$0")/.."

RESULTS_JSON="promptfoo-output/results.json"
FAILURES_JSON="promptfoo-output/failures.json"
# Prefer original test file (exclude *_refined.yaml) so we read valid YAML and write to _refined.
TEST_FILE=$(ls -t .specalign/test_cases/*.yaml 2>/dev/null | while read f; do
  [[ "$f" != *"_refined.yaml" ]] && echo "$f" && break
done)
if [ -z "$TEST_FILE" ]; then
  TEST_FILE=$(ls -t .specalign/test_cases/*.yaml 2>/dev/null | head -1)
fi

if [ -z "$TEST_FILE" ]; then
  echo "No test cases found. Run specalign generate first."
  exit 1
fi

if [ ! -f "$RESULTS_JSON" ]; then
  echo "No results.json. Run ./scripts/run-eval-with-summary.sh first."
  exit 1
fi

echo "Extracting failures..."
node scripts/extract-failures.js "$RESULTS_JSON" "$TEST_FILE" "$FAILURES_JSON"

FAIL_COUNT=$(node -e "console.log(require('./promptfoo-output/failures.json').length)")
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "No failures to refine."
  exit 0
fi

echo "Refining assertions with LLM..."
REFINED_YAML="${TEST_FILE%.yaml}_refined.yaml"
node scripts/refine-assertions.js "$FAILURES_JSON" "$TEST_FILE" "$REFINED_YAML"

echo "Re-running eval on refined tests..."
mkdir -p promptfoo-output
npx --yes promptfoo eval -c "$REFINED_YAML" --output promptfoo-output/report.html --output promptfoo-output/results.json || true
node scripts/generate-summary.js promptfoo-output/results.json "$REFINED_YAML" promptfoo-output/SUMMARY.md
node scripts/generate-analysis-html.js promptfoo-output/results.json "$REFINED_YAML" promptfoo-output/analysis.html

echo "Done. Refined test file: $REFINED_YAML"
echo "Summary: promptfoo-output/SUMMARY.md"

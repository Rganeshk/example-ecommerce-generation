#!/usr/bin/env node
/**
 * Extract failed tests from promptfoo results for self-refine.
 * Usage: node scripts/extract-failures.js <results.json> <config.yaml> [failures.json]
 * Output: JSON array of { testIndex, input, output, failingAssertion, reason }.
 */

const fs = require('fs');

function loadJSON(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node extract-failures.js <results.json> <config.yaml> [failures.json]');
    process.exit(1);
  }
  const resultsPath = args[0];
  const configPath = args[1];
  const outputPath = args[2] || 'promptfoo-output/failures.json';

  if (!fs.existsSync(resultsPath)) {
    console.error('Results file not found:', resultsPath);
    process.exit(1);
  }

  const data = loadJSON(resultsPath);
  const raw = data.results;
  const resultsArray = raw && (Array.isArray(raw) ? raw : raw.results || raw.outputs) || [];

  const failures = [];
  resultsArray.forEach((r, i) => {
    const pass = r.success === true || r.pass === true || (r.gradingResult && r.gradingResult.pass === true);
    if (pass) return;

    let failingAssertion = null;
    let reason = '';
    if (r.gradingResult && r.gradingResult.componentResults) {
      const failed = r.gradingResult.componentResults.find(c => c.pass === false);
      if (failed) {
        failingAssertion = failed.assertion && failed.assertion.value;
        reason = failed.reason || '';
      }
    }
    if (!failingAssertion && r.gradingResult) reason = r.gradingResult.reason || '';

    const input = (r.testCase && r.testCase.vars && r.testCase.vars.input) ? String(r.testCase.vars.input) : '';
    const output = (r.response && r.response.output) ? String(r.response.output) : '';

    failures.push({
      testIndex: i + 1,
      input: input.slice(0, 500),
      output: output.slice(0, 800),
      failingAssertion: failingAssertion || reason || '—',
      reason: reason.slice(0, 300),
    });
  });

  const outDir = outputPath.replace(/\/[^/]+$/, '');
  if (outDir && outDir !== outputPath && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(failures, null, 2), 'utf8');
  console.log('Wrote', outputPath, '(', failures.length, 'failures)');
}

main();

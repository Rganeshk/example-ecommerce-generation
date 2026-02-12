#!/usr/bin/env node
/**
 * Generate an HTML analysis report: summary, tables, why tests failed, and fix recommendations.
 * Usage: node scripts/generate-analysis-html.js <results.json> <config.yaml> [output.html]
 */

const fs = require('fs');

function loadJSON(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function loadYAML(path) {
  const raw = fs.readFileSync(path, 'utf8');
  const blocks = raw.split(/\n(?=-\s+vars:)/).filter(b => b.includes('vars:'));
  return {
    tests: blocks.map((block) => {
      const m = block.match(/spec_requirements:\s*\n\s*-\s+([^\n]+)/);
      return { metadata: { spec_requirements: m ? [m[1].trim()] : ['unknown'] } };
    })
  };
}

function getFailureHint(assertionValue) {
  if (!assertionValue || typeof assertionValue !== 'string') return { cause: 'Assertion failed', fix: 'Review the test assertion and prompt.' };
  const v = assertionValue.toLowerCase();
  if (v.includes("includes(") && v.includes("&&")) return { cause: 'Output did not contain all required words or phrases.', fix: 'Change the prompt so the model includes these concepts, or relax the test to accept synonyms (e.g. semantic checks).' };
  if (v.includes("includes(")) return { cause: 'Output did not contain the required text.', fix: 'Update the prompt to ask for this content, or use a more flexible assertion.' };
  if (v.includes("!output.includes")) return { cause: 'Output contained forbidden text.', fix: 'Add the forbidden term to the prompt\'s exclusion list or clarify wording.' };
  if (v.includes(".test(output)")) return { cause: 'Output did not match the required structure (e.g. HTML).', fix: 'Clarify the prompt’s output format or relax the regex.' };
  return { cause: 'Assertion condition was not met.', fix: 'Align the prompt with the specification or adjust the test.' };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node generate-analysis-html.js <results.json> <config.yaml> [output.html]');
    process.exit(1);
  }
  const resultsPath = args[0];
  const configPath = args[1];
  const outputPath = args[2] || 'promptfoo-output/analysis.html';

  const data = loadJSON(resultsPath);
  let config = { tests: [] };
  try {
    config = loadYAML(configPath);
  } catch (e) {}

  const raw = data.results;
  const resultsArray = raw && (Array.isArray(raw) ? raw : raw.results || raw.outputs) || [];
  const tests = config.tests || [];

  const bySpec = {};
  const failedRows = [];

  resultsArray.forEach((r, i) => {
    const test = tests[i] || {};
    const specKey = (test.metadata && test.metadata.spec_requirements && test.metadata.spec_requirements[0]) || 'unknown';
    if (!bySpec[specKey]) bySpec[specKey] = { pass: 0, fail: 0 };
    const pass = r.success === true || r.pass === true || (r.gradingResult && r.gradingResult.pass === true);
    if (pass) bySpec[specKey].pass++; else bySpec[specKey].fail++;

    if (!pass) {
      let failedAssertion = null;
      let reason = '';
      if (r.gradingResult && r.gradingResult.componentResults) {
        const failed = r.gradingResult.componentResults.find(c => c.pass === false);
        if (failed) {
          failedAssertion = failed.assertion && failed.assertion.value;
          reason = failed.reason || '';
        }
      }
      if (!failedAssertion && r.gradingResult) reason = r.gradingResult.reason || '';
      const inputSnippet = (r.testCase && r.testCase.vars && r.testCase.vars.input) ? String(r.testCase.vars.input).slice(0, 80) + '…' : '';
      const { cause, fix } = getFailureHint(failedAssertion);
      failedRows.push({
        index: i + 1,
        spec: specKey,
        assertion: failedAssertion || reason || '—',
        cause,
        fix,
        inputSnippet: escapeHtml(inputSnippet)
      });
    }
  });

  let totalPass = 0, totalFail = 0;
  Object.values(bySpec).forEach(s => { totalPass += s.pass; totalFail += s.fail; });
  const total = totalPass + totalFail;
  const passRate = total ? ((totalPass / total) * 100).toFixed(1) : '0';
  const passPct = Math.round((totalPass / total) * 100) || 0;

  const specRows = Object.keys(bySpec).sort().map(spec => {
    const s = bySpec[spec];
    const t = s.pass + s.fail;
    const rate = t ? ((s.pass / t) * 100).toFixed(1) : '0';
    return `<tr><td>${escapeHtml(spec)}</td><td>${s.pass}</td><td>${s.fail}</td><td>${t}</td><td>${rate}%</td></tr>`;
  }).join('');

  const failureRows = failedRows.map(f => `
    <tr>
      <td>${f.index}</td>
      <td>${escapeHtml(f.spec)}</td>
      <td><code>${escapeHtml(String(f.assertion || '').slice(0, 60))}${(f.assertion && f.assertion.length > 60) ? '…' : ''}</code></td>
      <td>${escapeHtml(f.cause)}</td>
      <td>${escapeHtml(f.fix)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eval Analysis – Summary &amp; Recommendations</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 1.5rem; color: #1a1a1a; line-height: 1.5; }
    h1 { margin-top: 0; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
    .summary-bar { display: flex; height: 28px; background: #e9ecef; border-radius: 6px; overflow: hidden; margin: 1rem 0; }
    .summary-bar-pass { background: #2e7d32; }
    .summary-bar-fail { background: #c62828; }
    .big-rate { font-size: 2rem; font-weight: 700; margin: 0.25rem 0; }
    .big-rate.ok { color: #2e7d32; }
    .big-rate.warn { color: #ed6c02; }
    .big-rate.bad { color: #c62828; }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border: 1px solid #dee2e6; }
    th { background: #f8f9fa; font-weight: 600; }
    tr:nth-child(even) { background: #f8f9fa; }
    code { font-size: 0.85em; background: #f1f3f4; padding: 0.15em 0.4em; border-radius: 4px; }
    .fix-box { background: #fff8e1; border-left: 4px solid #ed6c02; padding: 1rem; margin: 1rem 0; }
    ul { margin: 0.5rem 0; padding-left: 1.5rem; }
  </style>
</head>
<body>
  <h1>Prompt evaluation – analysis</h1>
  <p>Use this report to see why tests failed and what to change (e.g. prompts or assertions).</p>

  <h2>Summary</h2>
  <div class="summary-bar" title="${totalPass} passed, ${totalFail} failed">
    <div class="summary-bar-pass" style="width:${passPct}%"></div>
    <div class="summary-bar-fail" style="width:${100 - passPct}%"></div>
  </div>
  <p>
    <span class="big-rate ${passPct >= 70 ? 'ok' : passPct >= 40 ? 'warn' : 'bad'}">${passRate}%</span> pass rate
    &nbsp;|&nbsp; <strong>${totalPass}</strong> passed &nbsp;|&nbsp; <strong>${totalFail}</strong> failed &nbsp;|&nbsp; <strong>${total}</strong> total
  </p>

  <h2>Results by specification</h2>
  <table>
    <thead><tr><th>Specification</th><th>Passed</th><th>Failed</th><th>Total</th><th>Pass rate</th></tr></thead>
    <tbody>${specRows}</tbody>
  </table>

  <h2>Why tests are failing</h2>
  <p>Below: which assertion failed and what to do (e.g. change the prompt or relax the test).</p>
  <table>
    <thead><tr><th>Test #</th><th>Spec</th><th>Failed assertion</th><th>Likely cause</th><th>Fix</th></tr></thead>
    <tbody>${failureRows}</tbody>
  </table>

  <h2>What to do next</h2>
  <div class="fix-box">
    <ul>
      <li><strong>Low pass rate or many “required text” failures</strong> → Change the <strong>prompt</strong> so the model is instructed to include the key concepts (or use synonyms). Avoid requiring exact wording.</li>
      <li><strong>Forbidden-word failures</strong> → Add those terms to the prompt’s “do not use” list or tighten the wording.</li>
      <li><strong>Structure/regex failures</strong> → Clarify the prompt’s output format (e.g. HTML) or relax the test (e.g. allow newlines in tags).</li>
      <li><strong>One spec with many failures</strong> → Focus on that spec: improve the prompt for it or add project-specific assertions; keep specalign’s built-in maps scenario-agnostic.</li>
    </ul>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log('Wrote', outputPath);
}

main();

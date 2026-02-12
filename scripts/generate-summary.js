#!/usr/bin/env node
/**
 * Generate a markdown summary and recommendations from promptfoo eval results.
 * Usage: node scripts/generate-summary.js <results.json> <config.yaml> [output.md]
 *
 * Reads promptfoo results and test config, groups by spec, and writes:
 * - Overall and per-spec stats
 * - Failed test indices per spec
 * - Recommendations based on pass rate and failure patterns
 */

const fs = require('fs');
const path = require('path');

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadYAML(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const testBlocks = raw.split(/\n(?=-\s+vars:)/).filter(b => b.includes('vars:'));
  const tests = testBlocks.map((block) => {
    const specMatch = block.match(/spec_requirements:\s*\n\s*-\s+([^\n]+)/);
    const requirementMatch = block.match(/requirement:\s*(.+?)(?=\n|$)/m);
    return {
      metadata: {
        spec_requirements: specMatch ? [specMatch[1].trim()] : ['unknown'],
        requirement: requirementMatch ? requirementMatch[1].trim() : ''
      }
    };
  });
  return { tests };
}

function getRecommendations(bySpec, totalPass, totalFail, total) {
  const passRate = total ? (totalPass / total) * 100 : 0;
  const recs = [];

  if (total === 0) {
    recs.push('- Run `specalign generate` and ensure test case YAML exists.');
    return recs;
  }

  // Overall pass rate
  if (passRate < 40) {
    recs.push('- **Low pass rate**: Prefer semantic assertions (stems, synonyms) over exact wording. Review the generation prompt and ensure specs don’t require verbatim input copying.');
  } else if (passRate < 70) {
    recs.push('- **Moderate pass rate**: Focus on specs with the lowest pass rates (see table). Consider relaxing assertions for those specs or improving the prompt so the model reflects key concepts.');
  } else if (passRate >= 70) {
    recs.push('- **Good baseline**: Consider adding more test cases or tightening assertions for critical specs.');
  }

  // Per-spec: flag specs with 0% or very low pass
  const weakSpecs = Object.entries(bySpec)
    .map(([spec, s]) => ({ spec, rate: s.pass + s.fail > 0 ? (s.pass / (s.pass + s.fail)) * 100 : 0 }))
    .filter(({ rate }) => rate < 50 && rate >= 0);
  if (weakSpecs.length > 0) {
    recs.push('- **Specs with &lt;50% pass**: ' + weakSpecs.map(w => `\`${w.spec}\``).join(', ') + ' — review failing tests; the model may be paraphrasing or omitting required concepts. Improve the prompt or use more flexible assertions for these specs.');
  }

  // General
  recs.push('- Download the **promptfoo-results** artifact for the interactive HTML report (`report.html`) and full summary.');
  recs.push('- To improve results: refine the **prompt** so the model consistently includes required concepts, or add **project-specific assertions** in your test YAML (keep specalign’s built-in maps scenario-agnostic).');

  return recs;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node generate-summary.js <results.json> <config.yaml> [output.md]');
    process.exit(1);
  }
  const resultsPath = args[0];
  const configPath = args[1];
  const outputPath = args[2] || null;

  if (!fs.existsSync(resultsPath)) {
    console.error('Results file not found:', resultsPath);
    process.exit(1);
  }
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found:', configPath);
    process.exit(1);
  }

  let data;
  try {
    data = loadJSON(resultsPath);
  } catch (e) {
    console.error('Failed to parse results JSON:', e.message);
    process.exit(1);
  }

  let config = { tests: [] };
  try {
    config = loadYAML(configPath);
  } catch (e) {
    console.error('Failed to parse config YAML:', e.message);
  }

  const rawResults = data.results;
  const results = Array.isArray(rawResults)
    ? rawResults
    : (rawResults && (rawResults.outputs || rawResults.results)) || [];
  const tests = config.tests || [];
  const bySpec = {};

  results.forEach((r, i) => {
    const test = tests[i] || {};
    const meta = test.metadata || {};
    const specs = meta.spec_requirements || ['unknown'];
    const specKey = Array.isArray(specs) ? specs[0] : String(specs);
    if (!bySpec[specKey]) bySpec[specKey] = { pass: 0, fail: 0, cases: [] };
    const success = r.success === true || r.pass === true || (r.gradingResult && r.gradingResult.pass === true);
    if (success) bySpec[specKey].pass++; else bySpec[specKey].fail++;
    bySpec[specKey].cases.push({ index: i + 1, success, requirement: meta.requirement || '' });
  });

  let totalPass = 0, totalFail = 0;
  Object.values(bySpec).forEach(s => { totalPass += s.pass; totalFail += s.fail; });
  const total = totalPass + totalFail;
  const passRate = total ? ((totalPass / total) * 100).toFixed(1) : '0';
  const recommendations = getRecommendations(bySpec, totalPass, totalFail, total);

  const lines = [
    '# Prompt Evaluation Summary',
    '',
    '## Overall',
    '',
    `- **Total tests**: ${total}`,
    `- **Passed**: ${totalPass}`,
    `- **Failed**: ${totalFail}`,
    `- **Pass rate**: ${passRate}%`,
    '',
    '## By specification',
    ''
  ];

  Object.keys(bySpec).sort().forEach(spec => {
    const s = bySpec[spec];
    const specTotal = s.pass + s.fail;
    const specRate = specTotal ? ((s.pass / specTotal) * 100).toFixed(1) : '0';
    lines.push(`### ${spec}`);
    lines.push('');
    lines.push('| Passed | Failed | Total | Pass rate |');
    lines.push('|--------|--------|-------|-----------|');
    lines.push(`| ${s.pass} | ${s.fail} | ${specTotal} | ${specRate}% |`);
    lines.push('');
    const failed = s.cases.filter(c => !c.success);
    if (failed.length > 0) {
      lines.push('**Failed test indices:** ' + failed.map(c => c.index).join(', '));
      lines.push('');
    }
  });

  lines.push('---');
  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  recommendations.forEach(r => lines.push(r));
  lines.push('');

  const out = lines.join('\n');
  if (outputPath) {
    fs.writeFileSync(outputPath, out, 'utf8');
    console.log('Wrote', outputPath);
  } else {
    console.log(out);
  }
}

main();

#!/usr/bin/env node
/**
 * Refine brittle assertions using an LLM and patch the test YAML.
 * Usage: node scripts/refine-assertions.js <failures.json> <config.yaml> [output.yaml]
 * Requires: OPENAI_API_KEY. Uses gpt-4o-mini by default.
 */

const fs = require('fs');

function loadJSON(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function unescapeYamlValue(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/^['"]|['"]$/g, '').replace(/''/g, "'");
}

function escapeForYaml(str) {
  return "'" + String(str).replace(/'/g, "''") + "'";
}

async function callOpenAI(failures, apiKey) {
  const list = failures.slice(0, 20).map((f, i) => 
    `Test ${f.testIndex}:\n  Input: ${(f.input || '').slice(0, 200)}...\n  Output: ${(f.output || '').slice(0, 300)}...\n  Failing assertion: ${f.failingAssertion}\n  Reason: ${f.reason}`
  ).join('\n\n');

  const systemPrompt = `You are a test assertion refiner. Given failing promptfoo test assertions, rewrite ONLY the failing assertion to be less strict while still enforcing the spec. Use semantic checks (stems, synonyms) or relaxed regex where appropriate. Return valid JavaScript for promptfoo (e.g. output.toLowerCase().includes('stem') or regex). Do not change the test intent.`;

  const userPrompt = `These test assertions failed because they were too strict (e.g. exact words while the model paraphrased). Rewrite each failing assertion to be less brittle.\n\n${list}\n\nRules:\n- Rewrite ONLY the failing assertion (do not change other asserts).\n- Keep it valid JavaScript for promptfoo.\n- If you use regex, ensure the string is JSON-safe (escape backslashes correctly).`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_REFINE_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Force valid JSON to avoid parse errors from unescaped regex backslashes.
      // If the model doesn't support structured output, we'll fall back below.
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'assertion_refinements',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['refinements'],
            properties: {
              refinements: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['testIndex', 'refinedAssertion'],
                  properties: {
                    testIndex: { type: 'integer' },
                    refinedAssertion: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      temperature: 0.2,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('No content in OpenAI response');

  // Preferred path: structured JSON (response_format json_schema)
  try {
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.refinements)) return parsed.refinements;
    if (Array.isArray(parsed)) return parsed; // if model returns array directly
  } catch (_) {
    // Fall back below
  }

  // Fallback: attempt to extract an array from freeform text
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Could not find JSON array in response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    const debugPath = 'promptfoo-output/refine_llm_raw.txt';
    try { fs.writeFileSync(debugPath, content, 'utf8'); } catch (_) {}
    throw new Error(
      `Could not parse LLM JSON. Saved raw response to ${debugPath}. Original error: ${err.message}`
    );
  }
}

function patchYaml(yamlPath, failures, refinements, outputPath) {
  let yaml = fs.readFileSync(yamlPath, 'utf8');
  // Split into header (up to and including "tests:\n") and the test blocks body.
  const match = yaml.match(/([\s\S]*?\n)tests:\n([\s\S]*)/);
  if (!match) {
    throw new Error('Could not find "tests:" section in YAML');
  }
  const header = match[1] + 'tests:\n';
  const body = match[2] || '';
  const testBlocks = body.split(/\n(?=-\s+vars:)/);
  const refinementsByIndex = {};
  refinements.forEach(r => { refinementsByIndex[r.testIndex] = r.refinedAssertion; });

  failures.forEach(f => {
    const refined = refinementsByIndex[f.testIndex];
    if (!refined) return;
    const blockIdx = f.testIndex - 1;
    if (blockIdx < 0 || blockIdx >= testBlocks.length) return;

    const block = testBlocks[blockIdx];
    const failNorm = norm(f.failingAssertion);
    const lines = block.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*value:\s*)(.+)$/);
      if (!m) continue;
      const rawValue = m[2].trim();
      const unescaped = unescapeYamlValue(rawValue);
      if (norm(unescaped) !== failNorm) continue;
      lines[i] = m[1] + escapeForYaml(refined);
      break;
    }
    testBlocks[blockIdx] = lines.join('\n');
  });

  // Reassemble YAML: header (unchanged) + all test blocks joined with single newlines.
  const newYaml = header + testBlocks.join('\n');
  fs.writeFileSync(outputPath, newYaml, 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node refine-assertions.js <failures.json> <config.yaml> [output.yaml]');
    process.exit(1);
  }
  const failuresPath = args[0];
  const yamlPath = args[1];
  const outputPath = args[2] || yamlPath.replace(/\.yaml$/, '_refined.yaml');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is required');
    process.exit(1);
  }

  if (!fs.existsSync(failuresPath)) {
    console.error('Failures file not found:', failuresPath);
    process.exit(1);
  }
  if (!fs.existsSync(yamlPath)) {
    console.error('Config YAML not found:', yamlPath);
    process.exit(1);
  }

  const failures = loadJSON(failuresPath);
  if (failures.length === 0) {
    console.log('No failures to refine');
    return;
  }

  console.log('Calling LLM to refine', failures.length, 'assertions...');
  const refinements = await callOpenAI(failures, apiKey);
  console.log('Got', refinements.length, 'refinements');

  patchYaml(yamlPath, failures, refinements, outputPath);
  console.log('Wrote', outputPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

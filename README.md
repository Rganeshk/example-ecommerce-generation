# Example E-commerce Generation with specalign

This repository demonstrates using specalign to generate and evaluate synthetic test cases for e-commerce product description generation, with integrated CI/CD workflows using promptfoo.

## Overview

This project uses [specalign](https://github.com/malusamayo/specalign) to:
- Extract specifications from prompts
- Generate synthetic test cases with few-shot learning
- Evaluate prompts using promptfoo
- Automatically run evaluations via GitHub Actions CI/CD

## Repository Structure

```
example-ecommerce-generation/
├── .github/
│   └── workflows/
│       └── promptfoo.yml      # CI/CD workflow for prompt evaluation
├── .specalign/                # specalign workspace (partially gitignored)
│   └── test_cases/            # Generated test cases (committed for CI/CD)
│       └── test_cases_*.yaml  # Promptfoo test configuration files
├── README.md                   # This file
├── SETUP.md                    # Detailed setup instructions
└── .gitignore
```

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 20+ (for promptfoo)
- OpenAI API key
- specalign installed: `pip install -e /path/to/specalign`

### Setup Steps

1. **Clone this repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/example-ecommerce-generation.git
   cd example-ecommerce-generation
   ```

2. **Set up environment**
   ```bash
   # Create .env file with your API key
   echo "OPENAI_API_KEY=your_key_here" > .env
   export $(grep -v '^#' .env | xargs)
   ```

3. **Initialize specalign workspace** (if not already done)
   ```bash
   specalign init
   ```

4. **Generate test cases**
   ```bash
   specalign compile --model .specalign/models/default.yaml
   specalign generate --model .specalign/models/default.yaml --count 50
   ```

5. **Set up GitHub secret**
   - Go to: Settings → Secrets and variables → Actions
   - Add secret: `OPENAI_API_KEY` with your API key

6. **Push to trigger CI/CD**
   ```bash
   git add .
   git commit -m "Add test cases and CI/CD"
   git push origin main
   ```

## CI/CD Workflow

The repository includes a GitHub Actions workflow that:

- **Triggers on**: Push to main/develop, Pull Requests, Manual dispatch
- **Runs**: promptfoo evaluation on all test cases
- **Outputs**: 
  - Results as downloadable artifacts
  - PR comments with pass/fail summary (for PRs)

### Viewing Results

1. Go to **Actions** tab in GitHub
2. Click on the latest workflow run
3. **Dashboard link:** In the job **Summary** you’ll see a **Dashboard** link that opens the analysis report in the browser (tables, why tests failed, what to fix). The same link is posted in PR comments.
4. **Artifact:** Download the **promptfoo-results** artifact and open:
   - **report.html** — interactive promptfoo report
   - **analysis.html** — same as the dashboard (tables, pass-rate bar, failure reasons, fix recommendations)
   - **SUMMARY.md** — result summary by specification and recommendations
5. On pull requests, the workflow posts a comment with pass rate, recommendation, and the dashboard link.

**Dashboard (GitHub Pages):** The dashboard is published to GitHub Pages on push to `main` or `develop`, so the link works without downloading the artifact. To enable it: **Settings → Pages → Source: GitHub Actions**. The URL is `https://<owner>.github.io/<repo>/analysis.html`.

## Workflow Commands

### Generate New Test Cases

```bash
specalign generate \
  --model .specalign/models/default.yaml \
  --count 50 \
  --workers 10
```

### Evaluate Locally

To get **results and recommendations in the terminal** in one go:

```bash
./scripts/run-eval-with-summary.sh
```

This runs the eval, generates `promptfoo-output/SUMMARY.md` (with per-spec stats and recommendations) and `promptfoo-output/analysis.html` (tables, failure reasons, and fix tips), and **prints the summary to the terminal**. It also writes `promptfoo-output/report.html` and `promptfoo-output/results.json`.

To run only promptfoo (no summary/recommendations):

```bash
TEST_FILE=$(ls -t .specalign/test_cases/*.yaml | head -1)
promptfoo eval -c "$TEST_FILE"
```

### Update Test Cases

```bash
# Edit specifications in .specalign/specs/
# Regenerate test cases
specalign generate --model .specalign/models/default.yaml --count 50

# Commit and push - CI/CD will re-run automatically
git add .specalign/test_cases/
git commit -m "Update test cases"
git push
```

## Few-Shot Learning

To improve test case quality, add example data:

```bash
# Place examples in .specalign/examples/
# Supported formats: JSON, JSONL, CSV
# Must have 'input' or 'prompt' field

specalign generate \
  --model .specalign/models/default.yaml \
  --count 50 \
  --examples .specalign/examples/examples.csv
```

## Troubleshooting

### CI/CD Fails

- **"No test cases found"**: Ensure test cases are committed (check `.gitignore`)
- **"AuthenticationError"**: Verify `OPENAI_API_KEY` secret is set correctly
- **"Invalid YAML"**: Validate test cases file locally first

### Local Evaluation Fails

- Check API key: `echo $OPENAI_API_KEY`
- Verify promptfoo: `promptfoo --version`
- Validate YAML: Check test cases file syntax

## Results Analysis

Current baseline results:
- **Total Tests**: 49
- **Pass Rate**: ~14.29% (7 passed, 42 failed)

### Common Failure Reasons

1. **Exact word matching**: Tests check for specific words that model paraphrases
2. **Content expectations**: Tests expect exact phrases from input descriptions
3. **Structural mismatches**: Output format may differ slightly from expected

### Improving Pass Rate

1. **Refine test assertions**: Use semantic checks instead of exact word matches
2. **Update specifications**: Make requirements clearer in spec files
3. **Improve prompt**: Edit compiled prompt to be more explicit
4. **Add more examples**: Improve few-shot learning with better examples

## Contributing

1. Make changes to specifications in `.specalign/specs/`
2. Regenerate test cases
3. Commit and push
4. CI/CD will automatically evaluate
5. Review results and iterate

## Resources

- [specalign Documentation](https://github.com/malusamayo/specalign)
- [promptfoo Documentation](https://www.promptfoo.dev/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

## License

[Add your license here]

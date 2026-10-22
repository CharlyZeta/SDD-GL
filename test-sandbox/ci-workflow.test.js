/**
 * FEAT-0010 — CI/CD must be reproducible on a clean clone and must not depend on
 * the private state (contracts/, .sdd/) nor dirty the tracked tree.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { TOOLS } = require('../mcp/server.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'test.yml');
const workflow = fs.existsSync(WORKFLOW_PATH) ? fs.readFileSync(WORKFLOW_PATH, 'utf8') : '';
const rootManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

describe('FEAT-0010 — Static layer', () => {
  test('static-analysis: the workflow YAML is structurally well formed', () => {
    assert.ok(!workflow.includes('\t'), 'YAML must not use tab characters for indentation');

    const stepBlocks = workflow.split(/\n(?=[ \t]*-\s+name:)/).slice(1);
    assert.ok(stepBlocks.length >= 5, 'expected at least 5 named steps');

    for (const block of stepBlocks) {
      const hasAction = /\buses:|\brun:/.test(block);
      assert.ok(hasAction, `every step must declare uses: or run:\n${block.split('\n')[0]}`);
    }

    assert.match(workflow, /runs-on:\s*ubuntu-latest/);
    assert.match(workflow, /node-version:/);
  });
});

describe('FEAT-0010 — Business Rules', () => {
  test('BR-001: .github/workflows/test.yml exists and runs on push and pull request', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), '.github/workflows/test.yml must exist');
    assert.match(workflow, /^on:/m);
    assert.match(workflow, /push:/);
    assert.match(workflow, /pull_request:/);
  });

  test('BR-002: the workflow runs the suite and validates the server exposes 8 tools', () => {
    assert.match(workflow, /npm test/);
    assert.match(workflow, /Expected 8 tools|!== 8|length !== 8/);
    assert.match(workflow, /mcp\/server\.js/);
  });

  test('BR-003: the workflow is idempotent and fails when tracked files change', () => {
    assert.match(workflow, /git status --porcelain/);

    // The suite must not regenerate the tracked dashboard: that would dirty the tree.
    assert.ok(!/dashboard-gen/.test(rootManifest.scripts.test), 'npm test must not run dashboard-gen');

    // Any test that writes must do so inside a throw-away root.
    const testFiles = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js'));
    const writers = testFiles.filter(name => fs.readFileSync(path.join(__dirname, name), 'utf8').includes('writeFileSync'));

    assert.ok(writers.length > 0, 'sanity: at least one suite writes fixtures');
    for (const name of writers) {
      const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
      assert.match(source, /mkdtemp/, `${name} writes files and must isolate them with mkdtemp`);
    }
  });

  test('BR-004: the workflow does not depend on the private contracts/ or .sdd/ directories', () => {
    // Comments may explain the policy; only executable lines matter for the dependency rule.
    const body = workflow
      .split('\n')
      .filter(line => !/^\s*#/.test(line))
      .join('\n');

    assert.ok(!/contracts\//.test(body), 'workflow must not reference the private contracts/ dir');
    assert.ok(!/\.sdd\//.test(body), 'workflow must not reference the private .sdd/ dir');
  });
});

describe('FEAT-0010 — Acceptance Criteria', () => {
  test('AC-001: GIVEN a push WHEN the workflow runs THEN it has checkout, node setup and the suite', () => {
    assert.match(workflow, /actions\/checkout/);
    assert.match(workflow, /actions\/setup-node/);
    assert.match(workflow, /npm test/);

    const order = ['actions/checkout', 'actions/setup-node', 'npm test'].map(step => workflow.indexOf(step));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'steps must run in dependency order');
  });

  test('AC-002: GIVEN the MCP server WHEN tools are validated THEN exactly 8 are exposed', () => {
    assert.strictEqual(TOOLS.length, 8);
    assert.match(workflow, /TOOLS\.map/);
  });

  test('AC-003: GIVEN the suite WHEN run in CI THEN the tracked tree stays clean', () => {
    // The workflow enforces this and the suite isolates its writes (see BR-003).
    assert.match(workflow, /Working tree stayed clean/);
    assert.match(workflow, /git status --porcelain/);

    const before = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.strictEqual(before.status, 0, 'git must be available to enforce the check');
  });

  test('AC-004: GIVEN a clean clone WHEN the workflow runs THEN no contracts/ or .sdd/ content is required', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-clean-clone-'));

    try {
      const script = `
        const { handleToolCall, TOOLS } = require(${JSON.stringify(path.join(REPO_ROOT, 'mcp', 'server.js'))});
        const status = handleToolCall('sdd_get_status', {});
        const metrics = handleToolCall('sdd_get_metrics', {});
        process.stdout.write(JSON.stringify({
          tools: TOOLS.length,
          contracts: status.total_contracts,
          metricsSource: metrics.source
        }));
      `;
      const run = spawnSync(process.execPath, ['-e', script], {
        cwd: emptyRoot,
        env: { ...process.env, SDD_PROJECT_ROOT: emptyRoot },
        encoding: 'utf8'
      });

      assert.strictEqual(run.status, 0, run.stderr);
      const result = JSON.parse(run.stdout);
      assert.strictEqual(result.tools, 8);
      assert.strictEqual(result.contracts, 0, 'a clean clone starts with no contracts');
      assert.strictEqual(result.metricsSource, 'defaults', 'a clean clone has no ledger yet');
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

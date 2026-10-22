/**
 * FEAT-0016 — `.sdd/metrics.json` as the single source of truth for quality metrics.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Runs against a throw-away SDD_PROJECT_ROOT (non-destructive, FEAT-0006).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-metrics-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall, TOOLS } = require('../mcp/server.js');

const contractsDir = path.join(tempRoot, 'contracts');
const sddDir = path.join(tempRoot, '.sdd');
const metricsPath = path.join(sddDir, 'metrics.json');

fs.mkdirSync(contractsDir, { recursive: true });

function resetLedger() {
  if (fs.existsSync(metricsPath)) {
    fs.rmSync(metricsPath, { recursive: true, force: true });
  }
  fs.mkdirSync(sddDir, { recursive: true });
}

function writeContract(id, lines) {
  const file = path.join(contractsDir, `${id}.md`);
  fs.writeFileSync(file, `# CONTRACT: Fixture ${id}
# ID: ${id}
# Status: APPROVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## Completion Map
# [item-id]|[layer]|[test-id]|[agente]|[status]
${lines.join('\n')}
`, 'utf8');
  return file;
}

function readLedger() {
  return JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('FEAT-0016 — Main Flow', () => {
  test('Main Flow: a completed step creates the ledger with derived quality metrics', () => {
    resetLedger();
    const file = writeContract('FEAT-9101', [
      '# Main Flow | functional | functional-tests:FEAT-9101-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9101',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'lifecycle assertions green'
    });

    assert.strictEqual(result.item_status, 'PASS');
    assert.ok(fs.existsSync(metricsPath), 'metrics.json must exist after a step completes');

    const ledger = readLedger();
    assert.strictEqual(ledger.schema_version, 1);
    assert.strictEqual(ledger.counters.steps_total, 1);
    assert.strictEqual(ledger.counters.steps_pass, 1);
    assert.strictEqual(ledger.first_pass_quality_rate, 100);
    assert.strictEqual(ledger.counters.contracts_resolved, 1, 'a fully ✅ contract counts as resolved');
    assert.ok(typeof ledger.last_updated === 'string' && ledger.last_updated.length > 0);
    assert.ok(fs.readFileSync(file, 'utf8').includes('| ✅'));
  });
});

describe('FEAT-0016 — Alternative Flows', () => {
  test('AF-01: a corrupt ledger yields defaults plus an explicit warning', () => {
    resetLedger();
    fs.writeFileSync(metricsPath, '{ this is not json', 'utf8');

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.source, 'defaults');
    assert.match(result.warning, /unreadable/i);
    assert.strictEqual(result.first_pass_quality_rate, 0);
  });

  test('AF-01: an outdated schema is rejected instead of trusted', () => {
    resetLedger();
    fs.writeFileSync(metricsPath, JSON.stringify({ total_contracts: 4, first_pass_rate_feat: 80 }), 'utf8');

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.source, 'defaults');
    assert.match(result.warning, /unexpected schema/i);
    assert.strictEqual(result.first_pass_quality_rate, 0);
  });

  test('AF-02: an unwritable ledger blocks the step and rolls the contract back', () => {
    resetLedger();
    // A directory at the ledger path makes the atomic rename fail on every platform.
    fs.mkdirSync(metricsPath, { recursive: true });
    const file = writeContract('FEAT-9102', [
      '# Main Flow | functional | functional-tests:FEAT-9102-main | tester | ❌'
    ]);
    const before = fs.readFileSync(file, 'utf8');

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9102',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'assertions green'
    });

    assert.strictEqual(result.item_status, 'BLOCKED');
    assert.match(result.reason, /metrics\.json/i);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'contract must be rolled back');

    fs.rmSync(metricsPath, { recursive: true, force: true });
  });
});

describe('FEAT-0016 — Business Rules', () => {
  test('BR-001: the ledger is the single source of truth for quality metrics', () => {
    resetLedger();
    fs.writeFileSync(metricsPath, JSON.stringify({
      schema_version: 1,
      first_pass_quality_rate: 87.5,
      average_retries: 0.4,
      ambiguity_escalation_rate: 6.25,
      layer_success_rates: { functional: 90, static: 100, security: 100, arch: 100 },
      counters: {
        steps_total: 8, steps_pass: 7, steps_fail: 1, steps_blocked: 0,
        retries_total: 2, ambiguities_escalated: 0, contracts_resolved: 5
      },
      per_layer: {
        functional: { steps: 4, pass: 3, fail: 1 },
        static: { steps: 2, pass: 2, fail: 0 },
        security: { steps: 1, pass: 1, fail: 0 },
        arch: { steps: 1, pass: 1, fail: 0 }
      }
    }, null, 2), 'utf8');

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.first_pass_quality_rate, 87.5);
    assert.strictEqual(result.average_retries, 0.4);
    assert.strictEqual(result.counters.steps_total, 8);
    assert.strictEqual(result.layer_success_rates.functional, 90);
  });

  test('BR-002: with the file present the response is real data, not defaults', () => {
    resetLedger();
    fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
    fs.writeFileSync(metricsPath, JSON.stringify({
      schema_version: 1,
      counters: { steps_total: 3, steps_pass: 2, steps_fail: 1, steps_blocked: 0, retries_total: 1, ambiguities_escalated: 0, contracts_resolved: 2 },
      first_pass_quality_rate: 66.7
    }), 'utf8');

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.source, 'file');
    assert.strictEqual(result.warning, undefined);
    assert.strictEqual(result.counters.steps_total, 3);
    assert.strictEqual(result.first_pass_quality_rate, 66.7);
  });

  test('BR-003: the ledger is written atomically with no temp leftovers', () => {
    resetLedger();
    writeContract('FEAT-9103', [
      '# BR-003 | functional | unit-test:FEAT-9103-br003 | tester | ❌'
    ]);

    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9103',
      item_id: 'BR-003',
      result: 'PASS',
      evidence: 'atomicity check'
    });

    const leftovers = fs.readdirSync(sddDir).filter(name => name.includes('.tmp'));
    assert.deepStrictEqual(leftovers, []);
    assert.doesNotThrow(() => readLedger());
  });

  test('BR-004: the ledger stores no paths, PII or secrets', () => {
    resetLedger();
    writeContract('FEAT-9104', [
      '# BR-004 | functional | unit-test:FEAT-9104-br004 | tester | ❌'
    ]);

    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9104',
      item_id: 'BR-004',
      result: 'PASS',
      evidence: 'privacy check'
    });

    const raw = fs.readFileSync(metricsPath, 'utf8');
    assert.ok(!raw.includes(tempRoot), 'must not leak the project root path');
    assert.ok(!/api[_-]?key|password|secret|bearer/i.test(raw), 'must not contain secret-like keys');
    assert.ok(!raw.includes(os.userInfo().username), 'must not contain the OS user name');
  });
});

describe('FEAT-0016 — Acceptance Criteria', () => {
  test('AC-001: GIVEN the MCP server WHEN tools are listed THEN sdd_get_metrics is available', () => {
    const names = TOOLS.map(tool => tool.name);
    assert.ok(names.includes('sdd_get_metrics'));
  });

  test('AC-002: GIVEN no ledger WHEN sdd_get_metrics is called THEN zeroed defaults are returned without error', () => {
    resetLedger();

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.source, 'defaults');
    assert.strictEqual(result.first_pass_quality_rate, 0);
    assert.strictEqual(result.average_retries, 0);
    assert.strictEqual(result.counters.steps_total, 0);
    assert.strictEqual(result.layer_success_rates.functional, 0);
  });

  test('AC-003: GIVEN a ledger present WHEN sdd_get_metrics is called THEN the file values are returned', () => {
    resetLedger();
    fs.writeFileSync(metricsPath, JSON.stringify({
      schema_version: 1,
      first_pass_quality_rate: 75,
      counters: { steps_total: 4, steps_pass: 3, steps_fail: 1, steps_blocked: 0, retries_total: 0, ambiguities_escalated: 0, contracts_resolved: 2 }
    }), 'utf8');

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.first_pass_quality_rate, 75);
    assert.strictEqual(result.counters.steps_pass, 3);
    assert.strictEqual(result.source, 'file');
  });

  test('AC-004: GIVEN a Loop finishes a contract WHEN the ledger is read THEN FPQR and rates were updated', () => {
    resetLedger();
    writeContract('FEAT-9105', [
      '# Main Flow | functional | functional-tests:FEAT-9105-main | tester | ❌'
    ]);
    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9105',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'first step'
    });
    writeContract('FEAT-9106', [
      '# AC-001 | functional | assertion:FEAT-9106-ac001 | tester | ❌'
    ]);
    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9106',
      item_id: 'AC-001',
      result: 'FAIL',
      evidence: 'assertion failed'
    });

    const ledger = readLedger();

    assert.strictEqual(ledger.counters.steps_total, 2);
    assert.strictEqual(ledger.first_pass_quality_rate, 50);
    assert.strictEqual(ledger.layer_success_rates.functional, 50);
    assert.strictEqual(ledger.counters.contracts_resolved, 1);
    assert.ok(ledger.last_updated);
  });
});

/**
 * FEAT-0015 — sdd_step_loop must persist the REAL outcome of a Loop step.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * The suite runs against a throw-away SDD_PROJECT_ROOT so it never touches
 * the real contracts/ directory (FEAT-0006 non-destructive rule).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-step-loop-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall } = require('../mcp/server.js');

const contractsDir = path.join(tempRoot, 'contracts');
const runsDir = path.join(tempRoot, '.sdd', 'runs');

const OK_SCRIPT = path.join(tempRoot, 'verify-ok.js');
const FAIL_SCRIPT = path.join(tempRoot, 'verify-fail.js');
fs.mkdirSync(contractsDir, { recursive: true });
fs.writeFileSync(OK_SCRIPT, 'process.exit(0);\n', 'utf8');
fs.writeFileSync(FAIL_SCRIPT, 'console.error("boom-verification");\nprocess.exit(3);\n', 'utf8');

const MAP_HEADER = '# [item-id]|[layer]|[test-id]|[agente]|[status]';

function contractText(id, status, mode, lines) {
  return `# CONTRACT: Fixture for ${id}
# ID: ${id}
# Status: ${status}
# Mode: ${mode}
# Gate-Mode: EXPRESS

## Intent
Fixture contract used by the FEAT-0015 test suite.

## Completion Map
${MAP_HEADER}
${lines.join('\n')}
`;
}

function writeContract(id, status, mode, lines) {
  const file = path.join(contractsDir, `${id}.md`);
  fs.writeFileSync(file, contractText(id, status, mode, lines), 'utf8');
  return file;
}

function readContract(file) {
  return fs.readFileSync(file, 'utf8');
}

function mapLine(text, itemId, layer) {
  return text
    .split('\n')
    .find(line => line.startsWith('# ') && line.includes(`| ${layer} |`) && line.startsWith(`# ${itemId} |`));
}

function auditLogs(contractId) {
  const dir = path.join(runsDir, contractId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => path.join(dir, name));
}

function resetEnv() {
  delete process.env.SDD_LOOP_ACTIVE;
  delete process.env.SDD_LOOP_CMD_FUNCTIONAL;
  delete process.env.SDD_LOOP_CMD_STATIC;
  delete process.env.SDD_LOOP_CMD_SECURITY;
  delete process.env.SDD_LOOP_CMD_ARCH;
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('FEAT-0015 — Main Flow', () => {
  test('Main Flow: APPROVED/LOOP contract advances the map line to the real state', () => {
    resetEnv();
    const file = writeContract('FEAT-9001', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9001-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9001',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'npm test -> 44 pass / 0 fail'
    });

    assert.strictEqual(result.item_status, 'PASS');
    assert.strictEqual(result.previous_status, '❌');
    assert.strictEqual(result.new_status, '✅');
    assert.ok(mapLine(readContract(file), 'Main Flow', 'functional').endsWith('| ✅'));
  });
});

describe('FEAT-0015 — Alternative Flows', () => {
  test('AF-01: contract not in APPROVED/LOOP returns NOT_WRITABLE and mutates nothing', () => {
    resetEnv();
    const file = writeContract('FEAT-9002', 'DRAFT', 'GATE', [
      '# Main Flow | functional | functional-tests:FEAT-9002-main | tester | ❌'
    ]);
    const before = readContract(file);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9002', item_id: 'Main Flow' });

    assert.strictEqual(result.item_status, 'NOT_WRITABLE');
    assert.strictEqual(readContract(file), before);
  });

  test('AF-02: unknown item_id returns BLOCKED with a reason', () => {
    resetEnv();
    writeContract('FEAT-9003', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9003-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9003', item_id: 'AC-999' });

    assert.strictEqual(result.item_status, 'BLOCKED');
    assert.match(result.reason, /not found/i);
  });

  test('AF-03: an infrastructure error in verification returns FAIL with the detail', () => {
    resetEnv();
    process.env.SDD_LOOP_CMD_STATIC = `node "${FAIL_SCRIPT}"`;
    const file = writeContract('FEAT-9004', 'APPROVED', 'LOOP', [
      '# Main Flow | static | static-analysis:FEAT-9004-main | verifier | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9004', item_id: 'Main Flow', verify: true });

    assert.strictEqual(result.item_status, 'FAIL');
    assert.match(result.audit_log_path ? fs.readFileSync(result.audit_log_path, 'utf8') : '', /exit: 3/);
    assert.ok(mapLine(readContract(file), 'Main Flow', 'static').endsWith('| ❌'));
  });
});

describe('FEAT-0015 — Business Rules', () => {
  test('BR-001: only APPROVED + LOOP contracts can be stepped', () => {
    resetEnv();
    writeContract('FEAT-9005', 'APPROVED', 'GATE', [
      '# Main Flow | functional | functional-tests:FEAT-9005-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9005',
      item_id: 'Main Flow',
      result: 'PASS'
    });

    assert.strictEqual(result.item_status, 'NOT_WRITABLE');
  });

  test('BR-002: a step mutates exactly one Completion Map line', () => {
    resetEnv();
    const file = writeContract('FEAT-9006', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9006-main | tester | ❌',
      '# AF-01     | functional | unit-test:FEAT-9006-af01        | tester | ❌'
    ]);
    const before = readContract(file).split('\n');

    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9006',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'assertions 12/12'
    });

    const after = readContract(file).split('\n');
    const changed = before
      .map((line, index) => (line !== after[index] ? index : null))
      .filter(index => index !== null);

    assert.strictEqual(changed.length, 1);
    assert.ok(after[changed[0]].includes('✅'));
  });

  test('BR-003: state reflects the real result, never a static literal', () => {
    resetEnv();
    const failingFile = writeContract('FEAT-9007', 'APPROVED', 'LOOP', [
      '# Main Flow | static | static-analysis:FEAT-9007-main | verifier | ❌'
    ]);

    process.env.SDD_LOOP_CMD_STATIC = `node "${FAIL_SCRIPT}"`;
    const failing = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9007', item_id: 'Main Flow', verify: true });
    assert.strictEqual(failing.new_status, '❌');

    resetEnv();
    const passingFile = writeContract('FEAT-9008', 'APPROVED', 'LOOP', [
      '# Main Flow | static | static-analysis:FEAT-9008-main | verifier | ❌'
    ]);
    process.env.SDD_LOOP_CMD_STATIC = `node "${OK_SCRIPT}"`;
    const passing = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9008', item_id: 'Main Flow', verify: true });

    assert.strictEqual(passing.new_status, '✅');
    assert.ok(mapLine(readContract(passingFile), 'Main Flow', 'static').endsWith('| ✅'));
    assert.ok(mapLine(readContract(failingFile), 'Main Flow', 'static').endsWith('| ❌'));
  });

  test('BR-004: audit log lives in .sdd/runs/<contract_id>/ and names the item', () => {
    resetEnv();
    writeContract('FEAT-9009', 'APPROVED', 'LOOP', [
      '# AF-01 | functional | unit-test:FEAT-9009-af01 | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9009',
      item_id: 'AF-01',
      result: 'PASS',
      evidence: 'aff -01 assertions green'
    });

    assert.ok(result.audit_log_path.startsWith(path.join(runsDir, 'FEAT-9009')));
    assert.match(path.basename(result.audit_log_path), /^AF-01-/);
    const content = fs.readFileSync(result.audit_log_path, 'utf8');
    assert.match(content, /# Item: AF-01/);
    assert.match(content, /# Result: PASS/);
    assert.match(content, /aff -01 assertions green/);
  });

  test('BR-005: an already-✅ item stays ✅ when re-executed', () => {
    resetEnv();
    const file = writeContract('FEAT-9010', 'APPROVED', 'LOOP', [
      '# AC-001 | functional | assertion:FEAT-9010-ac001 | tester | ✅'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9010',
      item_id: 'AC-001',
      result: 'PASS',
      evidence: 're-run'
    });

    assert.strictEqual(result.item_status, 'PASS');
    assert.strictEqual(result.previous_status, '✅');
    assert.ok(mapLine(readContract(file), 'AC-001', 'functional').endsWith('| ✅'));
  });
});

describe('FEAT-0015 — Acceptance Criteria', () => {
  test('AC-001: GIVEN an APPROVED/LOOP contract with ❌ WHEN stepped THEN the line reaches the real state', () => {
    resetEnv();
    const file = writeContract('FEAT-9011', 'APPROVED', 'LOOP', [
      '# BR-001 | functional | unit-test:FEAT-9011-br001 | tester | ❌'
    ]);

    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9011',
      item_id: 'BR-001',
      result: 'FAIL',
      evidence: 'invariant violated: 1 !== 2'
    });

    assert.ok(mapLine(readContract(file), 'BR-001', 'functional').endsWith('| ❌'));
  });

  test('AC-002: GIVEN a DRAFT/GATE contract WHEN stepped THEN NOT_WRITABLE and the file is untouched', () => {
    resetEnv();
    const file = writeContract('FEAT-9012', 'DRAFT', 'GATE', [
      '# Main Flow | functional | functional-tests:FEAT-9012-main | tester | ❌'
    ]);
    const before = readContract(file);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9012', item_id: 'auto' });

    assert.strictEqual(result.item_status, 'NOT_WRITABLE');
    assert.strictEqual(readContract(file), before);
    assert.strictEqual(auditLogs('FEAT-9012').length, 0);
  });

  test('AC-003: GIVEN a non-existent item_id WHEN stepped THEN BLOCKED', () => {
    resetEnv();
    writeContract('FEAT-9013', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9013-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9013', item_id: 'BR-404' });

    assert.strictEqual(result.item_status, 'BLOCKED');
  });

  test('AC-004: GIVEN a successful step WHEN .sdd/runs is inspected THEN a log with the outcome exists', () => {
    resetEnv();
    writeContract('FEAT-9014', 'APPROVED', 'LOOP', [
      '# AC-004 | functional | assertion:FEAT-9014-ac004 | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9014',
      item_id: 'AC-004',
      result: 'PASS',
      evidence: 'assertion green'
    });

    assert.strictEqual(result.item_status, 'PASS');
    assert.ok(fs.existsSync(result.audit_log_path));
    assert.ok(auditLogs('FEAT-9014').length >= 1);
  });
});

describe('FEAT-0015 — Anti-fabrication guards', () => {
  test('BR-003 guard: no verification command and no reported result yields BLOCKED, not PASS', () => {
    resetEnv();
    const file = writeContract('FEAT-9015', 'APPROVED', 'LOOP', [
      '# Main Flow | manual | manual-check:FEAT-9015-main | tester | ❌'
    ]);
    const before = readContract(file);

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9015', item_id: 'Main Flow', verify: true });

    assert.strictEqual(result.item_status, 'BLOCKED');
    assert.match(result.reason, /No verification command/i);
    assert.strictEqual(readContract(file), before);
  });

  test('BR-003 guard: an invalid reported result is rejected instead of guessed', () => {
    resetEnv();
    writeContract('FEAT-9016', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9016-main | tester | ❌'
    ]);

    const result = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9016',
      item_id: 'Main Flow',
      result: 'PROBABLY_FINE'
    });

    assert.strictEqual(result.item_status, 'BLOCKED');
    assert.match(result.reason, /Invalid result/i);
  });

  test('BR-003 guard: recursive verification is refused instead of fabricating PASS', () => {
    resetEnv();
    writeContract('FEAT-9017', 'APPROVED', 'LOOP', [
      '# Main Flow | functional | functional-tests:FEAT-9017-main | tester | ❌'
    ]);
    process.env.SDD_LOOP_ACTIVE = '1';

    const result = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9017', item_id: 'Main Flow', verify: true });

    assert.strictEqual(result.item_status, 'BLOCKED');
    assert.match(result.reason, /Recursive verification/i);
  });
});

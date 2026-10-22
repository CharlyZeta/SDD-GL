/**
 * FEAT-0007 — The MCP server is a deterministic Gate/Loop/Audit ledger.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Runs against a throw-away SDD_PROJECT_ROOT (non-destructive, FEAT-0006).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-core-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall } = require('../mcp/server.js');

const contractsDir = path.join(tempRoot, 'contracts');
const runsDir = path.join(tempRoot, '.sdd', 'runs');
fs.mkdirSync(contractsDir, { recursive: true });

function writeContract(id, options = {}) {
  const {
    status = 'DRAFT',
    mode = 'GATE',
    mainFlow = ['Paso uno del flujo.', 'Paso dos del flujo.', 'Paso tres del flujo.'],
    alternativeFlows = ['- AF-01: condición -> resultado'],
    businessRules = ['- BR-001: monto > 0'],
    acceptanceCriteria = ['- AC-001: GIVEN contexto WHEN acción THEN monto = 5 es aceptado'],
    ambiguityLog = ['- [x] Ninguno'],
    completionMap = null,
    entities = ['- `mcp/server.js`: handler'],
    reproductionSteps = null
  } = options;

  const flowHeading = reproductionSteps ? 'Reproduction Steps' : 'Main Flow';
  const flowSteps = reproductionSteps || mainFlow;
  const mapBlock = completionMap === null ? '(built by Loop)' : completionMap.join('\n');

  const body = `# CONTRACT: Fixture ${id}
# ID: ${id}
# Status: ${status}
# Mode: ${mode}
# Gate-Mode: EXPRESS

## Intent
Fixture contract for FEAT-0007.

## Use Case
**Actor:** Tester
**Goal:** Exercise the ledger.

### ${flowHeading}
${flowSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

### Alternative Flows
${alternativeFlows.join('\n')}

## Business Rules
${businessRules.join('\n')}

## Acceptance Criteria
${acceptanceCriteria.join('\n')}

## Entities Affected
${entities.join('\n')}

## Ambiguity Log
${ambiguityLog.join('\n')}

## Completion Map
${mapBlock}
`;

  const file = path.join(contractsDir, `${id}.md`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function readFile(file) {
  return fs.readFileSync(file, 'utf8');
}

function statusOf(text, itemId) {
  const line = text.split('\n').find(l => l.startsWith(`# ${itemId} |`));
  return line ? line.trim().split('|').pop().trim() : null;
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('FEAT-0007 — Alternative Flows', () => {
  test('AF-01: a contract missing required sections returns INCOMPLETE with the detail', () => {
    writeContract('FEAT-9201', {
      businessRules: ['- ninguno'],
      mainFlow: ['Un solo paso.']
    });

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9201' });

    assert.strictEqual(result.status, 'INCOMPLETE');
    assert.ok(result.missing.some(issue => /Main Flow/.test(issue)));
    assert.ok(result.missing.some(issue => /Business Rules/.test(issue)));
  });

  test('AF-02: contradictory BR/AC returns CONTRADICTION_DETECTED', () => {
    writeContract('FEAT-9202', {
      businessRules: ['- BR-001: monto > 0'],
      acceptanceCriteria: ['- AC-002: GIVEN cuenta WHEN se acepta monto = 0 THEN es aceptado']
    });

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9202' });

    assert.strictEqual(result.status, 'CONTRADICTION_DETECTED');
    assert.strictEqual(result.contradictions.length, 1);
    assert.strictEqual(result.contradictions[0].br, 'BR-001');
    assert.strictEqual(result.contradictions[0].ac, 'AC-002');
  });

  test('AF-03: log_ambiguity marks the item ❌ and stops the Loop', () => {
    const file = writeContract('FEAT-9203', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# BR-001 | functional | unit-test:FEAT-9203-br001 | tester | ⏳'
      ]
    });

    const result = handleToolCall('sdd_log_ambiguity', {
      contract_id: 'FEAT-9203',
      item_id: 'BR-001',
      reason: 'La spec no define el redondeo del monto.'
    });

    const text = readFile(file);
    assert.strictEqual(result.item_marked, true);
    assert.strictEqual(statusOf(text, 'BR-001'), '❌');
    assert.match(text, /^# Status: DRAFT$/m);
    assert.match(text, /^# Mode: GATE$/m);
    assert.match(text, /- \[ \] BR-001: La spec no define el redondeo del monto\./);
  });
});

describe('FEAT-0007 — Business Rules', () => {
  test('BR-001: step_loop claims the item (⏳ + context) and never runs tests itself', () => {
    const file = writeContract('FEAT-9204', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# BR-001 | functional | unit-test:FEAT-9204-br001 | tester | ❌'
      ]
    });

    const claim = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9204', item_id: 'BR-001' });

    assert.strictEqual(claim.item_status, 'IN_PROGRESS');
    assert.strictEqual(claim.new_status, '⏳');
    assert.match(claim.criterion, /BR-001: monto > 0/);
    assert.strictEqual(statusOf(readFile(file), 'BR-001'), '⏳');
    assert.match(claim.next_action, /report back/i);
  });

  test('BR-002: validate_gate applies the FIX checklist instead of the FEAT one', () => {
    writeContract('FIX-9201', {
      mainFlow: ['Un paso.'],
      businessRules: ['- BR-001: invariante'],
      acceptanceCriteria: ['- AC-001: GIVEN a WHEN b THEN c']
    });

    const gate = handleToolCall('sdd_validate_gate', { contract_id: 'FIX-9201' });

    assert.strictEqual(gate.is_fix, true);
    assert.ok(gate.missing.some(issue => /Reproduction Steps/.test(issue)));
    assert.ok(!gate.missing.some(issue => /Business Rules/.test(issue)), 'FIX does not require BR');
  });

  test('BR-003: a consistent BR/AC pair is not reported as a contradiction', () => {
    writeContract('FEAT-9205', {
      businessRules: ['- BR-001: monto > 0'],
      acceptanceCriteria: ['- AC-001: GIVEN cuenta WHEN se deposita monto = 5 THEN es aceptado']
    });

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9205' });

    assert.deepStrictEqual(result.contradictions, []);
    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
  });

  test('BR-004: log_ambiguity persists ❌ plus the DRAFT/GATE transition on disk', () => {
    const file = writeContract('FEAT-9206', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# AC-001 | functional | assertion:FEAT-9206-ac001 | tester | ❌'
      ]
    });

    handleToolCall('sdd_log_ambiguity', {
      contract_id: 'FEAT-9206',
      item_id: 'AC-001',
      reason: 'Fuente de datos no definida en el Contract.'
    });

    const text = readFile(file);
    assert.match(text, /^# Status: DRAFT$/m);
    assert.match(text, /^# Mode: GATE$/m);
    assert.strictEqual(statusOf(text, 'AC-001'), '❌');
    assert.match(text, /## Ambiguity Log\n- \[ \] AC-001:/);
  });

  test('BR-005: audit_traceability computes real coverage instead of fixed values', () => {
    // A minimal corpus so BR-001 counts as covered while BR-777/AC-888 stay orphan.
    const corpusDir = path.join(tempRoot, 'test-sandbox');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(path.join(corpusDir, 'corpus.js'), '// covers BR-001 only\n', 'utf8');

    writeContract('FEAT-9207', {
      businessRules: ['- BR-001: monto > 0', '- BR-777: invariante sin test'],
      acceptanceCriteria: ['- AC-001: GIVEN a WHEN b THEN c', '- AC-888: GIVEN x WHEN y THEN z']
    });

    const audit = handleToolCall('sdd_audit_traceability', {});

    assert.strictEqual(audit.status, 'GAPS_FOUND');
    assert.ok(audit.orphan_specs.includes('FEAT-9207:BR-777'), 'untested BR must be an orphan spec');
    assert.ok(audit.orphan_specs.includes('FEAT-9207:AC-888'), 'untested AC must be an orphan spec');
    assert.ok(!audit.orphan_specs.includes('FEAT-9207:BR-001'), 'BR-001 is covered by the corpus');
    assert.ok(audit.total_criteria > 0);
    assert.notStrictEqual(audit.specification_coverage_score, 94.2, 'coverage must not be a fixed value');
  });

  test('BR-006: every Loop mutation is persisted before and after the item', () => {
    const file = writeContract('FEAT-9208', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# AF-01 | functional | unit-test:FEAT-9208-af01 | tester | ❌'
      ]
    });

    handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9208', item_id: 'AF-01' });
    assert.strictEqual(statusOf(readFile(file), 'AF-01'), '⏳', 'claim must be on disk immediately');

    handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9208',
      item_id: 'AF-01',
      result: 'PASS',
      evidence: 'AF-01 assertion green'
    });
    assert.strictEqual(statusOf(readFile(file), 'AF-01'), '✅', 'result must be on disk immediately');
  });
});

describe('FEAT-0007 — Acceptance Criteria', () => {
  test('AC-001: GIVEN ❌ WHEN claimed then reported PASS THEN ❌ → ⏳ → ✅ on disk', () => {
    const file = writeContract('FEAT-9209', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# Main Flow | functional | functional-tests:FEAT-9209-main | tester | ❌'
      ]
    });

    assert.strictEqual(statusOf(readFile(file), 'Main Flow'), '❌');

    const claim = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9209', item_id: 'Main Flow' });
    assert.strictEqual(claim.new_status, '⏳');
    assert.strictEqual(statusOf(readFile(file), 'Main Flow'), '⏳');

    const record = handleToolCall('sdd_step_loop', {
      contract_id: 'FEAT-9209',
      item_id: 'Main Flow',
      result: 'PASS',
      evidence: 'npm test 84 pass'
    });
    assert.strictEqual(record.new_status, '✅');
    assert.strictEqual(statusOf(readFile(file), 'Main Flow'), '✅');
  });

  test('AC-002: GIVEN a contract without BR WHEN validated THEN INCOMPLETE with the missing detail', () => {
    writeContract('FEAT-9210', { businessRules: ['- ninguno'] });

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9210' });

    assert.strictEqual(result.status, 'INCOMPLETE');
    assert.ok(result.missing.some(issue => /Business Rules must declare at least 1 BR-XXX/.test(issue)));
  });

  test('AC-003: GIVEN monto > 0 vs monto = 0 WHEN validated THEN CONTRADICTION_DETECTED', () => {
    writeContract('FEAT-9211', {
      businessRules: ['- BR-001: monto > 0'],
      acceptanceCriteria: ['- AC-002: GIVEN pago WHEN monto = 0 THEN se acepta']
    });

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9211' });

    assert.strictEqual(result.status, 'CONTRADICTION_DETECTED');
    assert.match(result.contradictions[0].reason, /monto > 0/);
  });

  test('AC-004: GIVEN a failed item WHEN the ambiguity is logged THEN ❌ and DRAFT/GATE', () => {
    const file = writeContract('FEAT-9212', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: [
        '# [item-id]|[layer]|[test-id]|[agente]|[status]',
        '# BR-001 | functional | unit-test:FEAT-9212-br001 | tester | ⏳'
      ]
    });

    handleToolCall('sdd_log_ambiguity', {
      contract_id: 'FEAT-9212',
      item_id: 'BR-001',
      reason: 'Falla persistente: el invariante no es verificable con los datos actuales.'
    });

    const text = readFile(file);
    assert.strictEqual(statusOf(text, 'BR-001'), '❌');
    assert.match(text, /^# Mode: GATE$/m);
  });

  test('AC-005: GIVEN BR/AC without an associated test WHEN audited THEN they are real orphan_specs', () => {
    writeContract('FEAT-9213', {
      businessRules: ['- BR-123: regla sin test'],
      acceptanceCriteria: ['- AC-456: GIVEN a WHEN b THEN c']
    });

    const audit = handleToolCall('sdd_audit_traceability', {});

    assert.ok(audit.orphan_specs.includes('FEAT-9213:BR-123'));
    assert.ok(audit.orphan_specs.includes('FEAT-9213:AC-456'));
    assert.strictEqual(audit.covered_criteria, audit.total_criteria - audit.orphan_specs.length);
  });

  test('Main Flow: a contract without Completion Map gets one built and persisted', () => {
    const file = writeContract('FEAT-9214', {
      status: 'APPROVED',
      mode: 'LOOP',
      completionMap: null
    });

    const claim = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9214', item_id: 'auto' });
    const text = readFile(file);

    assert.strictEqual(claim.item_status, 'IN_PROGRESS');
    assert.match(text, /## Completion Map/);
    assert.match(text, /# Main Flow \| functional \| functional-tests:FEAT-9214-main \| tester \| ⏳/);
    assert.match(text, /# BR-001 \| functional \| unit-test:FEAT-9214-br001 \| tester \| ❌/);

    const logs = fs.existsSync(path.join(runsDir, 'FEAT-9214'));
    assert.ok(logs, 'claim must leave a Glass Box entry');
  });
});

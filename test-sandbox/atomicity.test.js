/**
 * Atomicity at the Gate — one user story, one goal, bounded size.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-atomic-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall } = require('../mcp/server.js');

const contractsDir = path.join(tempRoot, 'contracts');

function writeContract(id, { story = null, status = 'DRAFT', brCount = 1, ambiguity = '- [x] Ninguna' } = {}) {
  fs.mkdirSync(contractsDir, { recursive: true });

  const storyBlock = story === null
    ? ''
    : `## User Story\n- Como: usuario\n- Quiero: ${story}\n- Para: lograr el objetivo\n\n`;

  const rules = Array.from({ length: brCount }, (_, index) => `- BR-00${index + 1}: invariante ${index + 1}`).join('\n');

  const body = `# CONTRACT: Fixture ${id}
# ID: ${id}
# Status: ${status}
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Fixture.

${storyBlock}## Use Case
**Actor:** usuario
**Goal:** probar

### Main Flow
1. Uno.
2. Dos.
3. Tres.

### Alternative Flows
- AF-01: condición -> resultado

## Business Rules
${rules}

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c

## Ambiguity Log
${ambiguity}
`;

  fs.writeFileSync(path.join(contractsDir, `${id}.md`), body, 'utf8');
}

function validate(id) {
  return handleToolCall('sdd_validate_gate', { contract_id: id });
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Atomicity — user story', () => {
  test('a DRAFT without User Story is INCOMPLETE with STORY_MISSING', () => {
    writeContract('FEAT-9501', { story: null });

    const result = validate('FEAT-9501');

    assert.strictEqual(result.status, 'INCOMPLETE');
    assert.ok(result.missing.some(issue => /STORY_MISSING/.test(issue)));
  });

  test('a story with two goals joined by a connector is flagged', () => {
    writeContract('FEAT-9502', { story: 'crear y aprobar contratos en un solo paso' });

    const result = validate('FEAT-9502');

    assert.ok(result.missing.some(issue => /STORY_MULTI_GOAL/.test(issue)));
  });

  test('a single-goal story is accepted', () => {
    writeContract('FEAT-9503', { story: 'validar el contrato antes de aprobarlo' });

    const result = validate('FEAT-9503');

    assert.ok(!result.missing.some(issue => /STORY_/.test(issue)));
    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
  });

  test('STORY-OK with a reason waives the check', () => {
    writeContract('FEAT-9504', {
      story: null,
      ambiguity: '- [x] STORY-OK: el pedido original no tenía historia'
    });

    const result = validate('FEAT-9504');

    assert.ok(!result.missing.some(issue => /STORY_MISSING/.test(issue)));
  });
});

describe('Atomicity — size budget', () => {
  test('more than 7 business rules exceeds the budget', () => {
    writeContract('FEAT-9505', { story: 'validar el contrato', brCount: 8 });

    const result = validate('FEAT-9505');

    assert.ok(result.missing.some(issue => /BUDGET_EXCEEDED/.test(issue)));
    assert.ok(result.missing.some(issue => /8 BR/.test(issue)));
  });

  test('BUDGET-OK with a reason waives the check', () => {
    writeContract('FEAT-9506', {
      story: 'validar el contrato',
      brCount: 8,
      ambiguity: '- [x] BUDGET-OK: contrato heredado de una migración'
    });

    const result = validate('FEAT-9506');

    assert.ok(!result.missing.some(issue => /BUDGET_EXCEEDED/.test(issue)));
  });

  test('a contract within the budget passes', () => {
    writeContract('FEAT-9507', { story: 'validar el contrato', brCount: 5 });

    const result = validate('FEAT-9507');

    assert.ok(!result.missing.some(issue => /BUDGET_EXCEEDED/.test(issue)));
  });
});

describe('Atomicity — no retroactive invalidation', () => {
  test('a RESOLVED contract is not re-checked for story or budget', () => {
    writeContract('FEAT-9508', { story: null, status: 'RESOLVED', brCount: 9 });

    const result = validate('FEAT-9508');

    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
    assert.ok(!result.missing.some(issue => /STORY_|BUDGET_/.test(issue)));
  });
});

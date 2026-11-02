/**
 * `sdd split` — proposes the cut of an oversized contract.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-split-'));

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: root }
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function contract(file, body) {
  fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'contracts', file), body, 'utf8');
}

const OVER_BUDGET = `# CONTRACT: Facturación electrónica
# ID: FEAT-0010
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Business Rules
${Array.from({ length: 8 }, (_, index) => `- BR-00${index + 1}: invariante ${index + 1}`).join('\n')}

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c
- AC-002: GIVEN d WHEN e THEN f
- AC-003: GIVEN g WHEN h THEN i

## Entities Affected
- \`src/billing/invoice.ts\`
`;

const MULTI_COMPONENT = `# CONTRACT: Checkout y facturación
# ID: FEAT-0011
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Business Rules
- BR-001: the cart total is never negative
- BR-002: the invoice includes VAT

## Acceptance Criteria
- AC-001: GIVEN a cart WHEN it closes THEN the total is shown
- AC-002: GIVEN an invoice WHEN it is issued THEN the number is unique

## Entities Affected
- \`src/cart/cart.ts\`
- \`src/billing/invoice.ts\`
`;

const ATOMIC = `# CONTRACT: Redondeo
# ID: FIX-0012
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Business Rules
- BR-001: rounding happens once

## Acceptance Criteria
- AC-001: GIVEN a cart WHEN it rounds THEN the total matches

## Entities Affected
- \`src/cart/round.ts\`
`;

before(() => {
  contract('FEAT-0010.md', OVER_BUDGET);
  contract('FEAT-0011.md', MULTI_COMPONENT);
  contract('FIX-0012.md', ATOMIC);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('split — budget', () => {
  test('an over-budget contract is cut into contiguous parts', () => {
    const result = run(['split', 'FEAT-0010', '--json']);
    const plan = JSON.parse(result.stdout);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(plan.needs_split, true);
    assert.strictEqual(plan.reason, 'budget');
    assert.strictEqual(plan.parts.length, 2);

    const first = plan.parts[0].businessRules.map(item => item.id);
    const second = plan.parts[1].businessRules.map(item => item.id);
    assert.deepStrictEqual(first, ['BR-001', 'BR-002', 'BR-003', 'BR-004']);
    assert.deepStrictEqual(second, ['BR-005', 'BR-006', 'BR-007', 'BR-008']);
    assert.deepStrictEqual(plan.parts[0].acceptanceCriteria.map(item => item.id), ['AC-001', 'AC-002']);
    assert.deepStrictEqual(plan.parts[1].acceptanceCriteria.map(item => item.id), ['AC-003']);
  });

  test('the proposed IDs do not collide with existing contracts', () => {
    const plan = JSON.parse(run(['split', 'FEAT-0010', '--json']).stdout);
    assert.strictEqual(plan.proposed_ids.length, plan.parts.length);
    for (const id of plan.proposed_ids) {
      assert.ok(!fs.existsSync(path.join(root, 'contracts', `${id}.md`)));
    }
    assert.strictEqual(new Set(plan.proposed_ids).size, plan.proposed_ids.length);
  });
});

describe('split — components', () => {
  test('criteria are grouped by the entity they mention', () => {
    const plan = JSON.parse(run(['split', 'FEAT-0011', '--json']).stdout);

    assert.strictEqual(plan.reason, 'multi-component');
    assert.strictEqual(plan.parts.length, 2);

    const cart = plan.parts.find(part => /cart/.test(part.entity));
    const invoice = plan.parts.find(part => /invoice/.test(part.entity));

    assert.ok(cart && invoice, 'both components must appear');
    assert.deepStrictEqual(cart.businessRules.map(item => item.id), ['BR-001']);
    assert.deepStrictEqual(invoice.businessRules.map(item => item.id), ['BR-002']);
    assert.deepStrictEqual(cart.acceptanceCriteria.map(item => item.id), ['AC-001']);
    assert.deepStrictEqual(invoice.acceptanceCriteria.map(item => item.id), ['AC-002']);
  });
});

describe('split — atomic contracts', () => {
  test('a contract within budget and with one entity is already atomic', () => {
    const result = run(['split', 'FIX-0012', '--json']);
    const plan = JSON.parse(result.stdout);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(plan.needs_split, false);
  });
});

describe('split — write', () => {
  test('--write creates DRAFT stubs and records the split in the parent', () => {
    const result = run(['split', 'FEAT-0010', '--write', '--json']);
    const plan = JSON.parse(result.stdout);
    assert.strictEqual(result.code, 0);

    for (const [index, id] of plan.proposed_ids.entries()) {
      const file = path.join(root, 'contracts', `${id}.md`);
      assert.ok(fs.existsSync(file), `${id} must exist`);

      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /^# Status: DRAFT$/m);
      assert.match(text, new RegExp(`^# Split-From: FEAT-0010$`, 'm'));

      const expected = plan.parts[index].businessRules.map(item => item.id);
      for (const rule of expected) assert.ok(text.includes(rule), `${id} must include ${rule}`);
    }

    const parent = fs.readFileSync(path.join(root, 'contracts', 'FEAT-0010.md'), 'utf8');
    assert.match(parent, /^## Splits$/m);
    for (const id of plan.proposed_ids) assert.ok(parent.includes(id));
  });

  test('the created stubs are valid drafts that Gate can inspect', () => {
    const plan = JSON.parse(run(['split', 'FEAT-0011', '--write', '--json']).stdout);
    const validation = run(['validate', plan.proposed_ids[0], '--json']);
    const result = JSON.parse(validation.stdout);

    // They are stubs: Gate must report what is missing, not crash.
    assert.strictEqual(result.contract_id, plan.proposed_ids[0]);
    assert.ok(Array.isArray(result.missing));
    assert.ok(result.missing.length > 0);
  });
});

/**
 * Per-criterion invalidation — editing one rule re-opens only that item.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-reconcile-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { reconcileContract, handleToolCall } = require('../mcp/server.js');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');
const contractsDir = path.join(tempRoot, 'contracts');

function contractText(id) {
  return fs.readFileSync(path.join(contractsDir, `${id}.md`), 'utf8');
}

function writeContract(id, { status = 'APPROVED', br = [], ac = [], flow = [] } = {}) {
  fs.mkdirSync(contractsDir, { recursive: true });

  const body = `# CONTRACT: Fixture ${id}
# ID: ${id}
# Status: ${status}
# Mode: LOOP
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: probar la reconciliación
- Para: no repetir trabajo

## Use Case
**Actor:** usuario
**Goal:** probar

### Main Flow
${flow.map((step, index) => `${index + 1}. ${step}`).join('\n')}

### Alternative Flows
- AF-01: condición -> resultado

## Business Rules
${br.join('\n')}

## Acceptance Criteria
${ac.join('\n')}

## Ambiguity Log
- [x] Ninguna

## Completion Map
# [item-id]|[layer]|[test-id]|[agente]|[status]
${flow.length ? '# Main Flow | functional | functional-tests:' + id + '-main | tester | ✅' : ''}
${flow.length ? '# Main Flow | static | static-analysis:' + id + '-main | verifier | ✅' : ''}
${flow.length ? '# Main Flow | security | security-scan:' + id + '-main | verifier | ✅' : ''}
${flow.length ? '# Main Flow | arch | arch-guard:' + id + '-main | verifier | ✅' : ''}
${br.map((_, index) => `# BR-00${index + 1} | functional | unit-test:${id}-br00${index + 1} | tester | ✅`).join('\n')}
${ac.map((_, index) => `# AC-00${index + 1} | functional | assertion:${id}-ac00${index + 1} | tester | ✅`).join('\n')}
# AF-01 | functional | unit-test:${id}-af01 | tester | ✅
`;

  fs.writeFileSync(path.join(contractsDir, `${id}.md`), body, 'utf8');
}

function run(args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--root', tempRoot], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: tempRoot }
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  writeContract('FEAT-9801', {
    flow: ['Uno.', 'Dos.', 'Tres.'],
    br: ['- BR-001: el total nunca es negativo', '- BR-002: el cupón aplica una vez'],
    ac: ['- AC-001: GIVEN carrito WHEN cierra THEN total visible']
  });

  // First reconciliation stores the baseline without changing anything.
  const baseline = reconcileContract('FEAT-9801');
  assert.strictEqual(baseline.changed, false);
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Reconcile — a single criterion changes', () => {
  test('only the edited rule is reset, the rest keeps its ✅', () => {
    const before = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      before.replace('el total nunca es negativo', 'el total nunca supera el subtotal'),
      'utf8'
    );

    const result = reconcileContract('FEAT-9801');
    assert.strictEqual(result.changed, true);
    assert.deepStrictEqual(result.changes.map(change => change.item), ['BR-001']);

    const text = contractText('FEAT-9801');
    assert.match(text, /# BR-001 \| functional \| unit-test:FEAT-9801-br001 \| tester \| ❌/);
    assert.match(text, /# BR-002 \| functional \| unit-test:FEAT-9801-br002 \| tester \| ✅/);
    assert.match(text, /# AC-001 \| functional \| assertion:FEAT-9801-ac001 \| tester \| ✅/);
    assert.match(text, /# Main Flow \| functional \| functional-tests:FEAT-9801-main \| tester \| ✅/);
  });

  test('whitespace-only edits do not invalidate', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('- BR-002: el cupón aplica una vez', '- BR-002:   el cupón   aplica una vez'),
      'utf8'
    );

    const result = reconcileContract('FEAT-9801');
    assert.strictEqual(result.changed, false);
  });
});

describe('Reconcile — criteria added and removed', () => {
  test('a new rule is added as ❌', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('- BR-002:   el cupón   aplica una vez', '- BR-002:   el cupón   aplica una vez\n- BR-003: el envío es gratis'),
      'utf8'
    );

    const result = reconcileContract('FEAT-9801');
    assert.strictEqual(result.added, 1);
    assert.match(contractText('FEAT-9801'), /# BR-003 \| functional \| unit-test:FEAT-9801-br003 \| tester \| ❌/);
  });

  test('a removed rule disappears from the map', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('- BR-003: el envío es gratis\n', ''),
      'utf8'
    );

    const result = reconcileContract('FEAT-9801');
    assert.strictEqual(result.removed, 1);
    assert.ok(!contractText('FEAT-9801').includes('BR-003'));
  });

  test('a change in the Main Flow resets the four layer rows', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('3. Tres.', '3. Tres pasos distintos.'),
      'utf8'
    );

    const result = reconcileContract('FEAT-9801');
    assert.strictEqual(result.changed, true);

    const updated = contractText('FEAT-9801');
    assert.match(updated, /# Main Flow \| functional \| functional-tests:FEAT-9801-main \| tester \| ❌/);
    assert.match(updated, /# Main Flow \| static \| static-analysis:FEAT-9801-main \| verifier \| ❌/);
    assert.match(updated, /# Main Flow \| security \| security-scan:FEAT-9801-main \| verifier \| ❌/);
    assert.match(updated, /# Main Flow \| arch \| arch-guard:FEAT-9801-main \| verifier \| ❌/);
  });
});

describe('Reconcile — integration', () => {
  test('the Loop reconciles before claiming an item', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('el cupón   aplica una vez', 'el cupón nunca se duplica'),
      'utf8'
    );

    const claim = handleToolCall('sdd_step_loop', { contract_id: 'FEAT-9801', item_id: 'BR-002' });

    assert.strictEqual(claim.item_status, 'IN_PROGRESS');
    assert.match(contractText('FEAT-9801'), /# BR-002 \| functional \| unit-test:FEAT-9801-br002 \| tester \| ⏳/);
  });

  test('the CLI exposes the same reconciliation', () => {
    const text = contractText('FEAT-9801');
    fs.writeFileSync(
      path.join(contractsDir, 'FEAT-9801.md'),
      text.replace('el total nunca supera el subtotal', 'el total nunca supera el subtotal con impuestos'),
      'utf8'
    );

    const result = run(['reconcile', 'FEAT-9801', '--json']);
    const data = JSON.parse(result.stdout);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(data.changed, true);
    assert.ok(data.changes.some(change => change.item === 'BR-001'));
  });

  test('the state file records the criterion hashes', () => {
    const stateFile = path.join(tempRoot, '.sdd', 'state', 'FEAT-9801.json');
    assert.ok(fs.existsSync(stateFile));

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(state.contract, 'FEAT-9801');
    assert.match(state.criteria['BR-001'], /^[0-9a-f]{16}$/);
    assert.match(state.criteria['Main Flow'], /^[0-9a-f]{16}$/);
  });
});

/**
 * CLI — the human-facing interface must work without an MCP client.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Runs against throw-away project roots (non-destructive).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-'));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || tempRoot,
    env: { ...process.env, SDD_PROJECT_ROOT: options.cwd || tempRoot, SDD_TELEMETRY: 'off' },
    encoding: 'utf8'
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeContract(name, content) {
  const dir = path.join(tempRoot, 'contracts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

const READY_FIX = `# CONTRACT: Algo roto
# ID: FIX-9401
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Pasos
1. Uno.
2. Dos.
3. Tres.

## Criterios de Aceptación
- AC-001: GIVEN a WHEN b THEN c

## Registro de Ambigüedades
- [x] Ninguna
`;

const INCOMPLETE_FEAT = `# CONTRACT: Algo grande
# ID: FEAT-9402
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Intent
Falta casi todo.

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Main Flow
1. Un solo paso.

## Ambiguity Log
- [ ] Falta decidir el alcance.
`;

before(() => {
  writeContract('FIX-9401.md', READY_FIX);
  writeContract('FEAT-9402.md', INCOMPLETE_FEAT);

  // A resolved contract with a full map and run logs, for the report command.
  writeContract('FEAT-9403.md', `# CONTRACT: Contrato cerrado
# ID: FEAT-9403
# Status: RESOLVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Main Flow
1. Uno.
2. Dos.
3. Tres.

## Business Rules
- BR-001: invariante

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c

## Ambiguity Log
- [x] Ninguna

## Completion Map
# [item-id]|[layer]|[test-id]|[agente]|[status]
# Main Flow | functional | functional-tests:FEAT-9403-main | tester | ✅
# BR-001 | functional | unit-test:FEAT-9403-br001 | tester | ✅
# AC-001 | functional | assertion:FEAT-9403-ac001 | tester | ✅
`);

  const runsDir = path.join(tempRoot, '.sdd', 'runs', 'FEAT-9403');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, 'BR-001-2026-01-01T00-00-00.log'), `# EXECUTION AUDIT: FEAT-9403
# Timestamp: 2026-01-01T00:00:00.000Z
# Item: BR-001
# Layer: functional
# Event: CLAIM
# Previous Status: ❌
# New Status: ⏳
`, 'utf8');
  fs.writeFileSync(path.join(runsDir, 'BR-001-2026-01-01T00-01-00.log'), `# EXECUTION AUDIT: FEAT-9403
# Timestamp: 2026-01-01T00:01:00.000Z
# Item: BR-001
# Layer: functional
# Previous Status: ⏳
# New Status: ✅
# Result: PASS
`, 'utf8');
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('CLI — protocol and usage', () => {
  test('--help prints the usage and exits 0', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /sdd <comando>/);
  });

  test('an unknown command exits 2 with usage', () => {
    const result = run(['frobnicate']);
    assert.strictEqual(result.code, 2);
    assert.match(result.stderr + result.stdout, /comando desconocido/i);
  });
});

describe('CLI — status', () => {
  test('status --json returns every contract with progress', () => {
    const result = run(['status', '--json']);
    assert.strictEqual(result.code, 0);

    const data = JSON.parse(result.stdout);
    assert.strictEqual(data.total_contracts, 3);

    const resolved = data.contracts.find(contract => contract.id === 'FEAT-9403');
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.deepStrictEqual(resolved.progress, { total: 3, done: 3 });
  });

  test('status on an empty project creates nothing', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-empty-'));
    try {
      const result = run(['status', '--json'], { cwd: emptyRoot });
      assert.strictEqual(result.code, 0);
      assert.deepStrictEqual(JSON.parse(result.stdout).contracts, []);
      assert.deepStrictEqual(fs.readdirSync(emptyRoot), [], 'a read command must not create files');
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('CLI — validate', () => {
  test('a ready contract exits 0', () => {
    const result = run(['validate', 'FIX-9401']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /READY_FOR_APPROVAL/);
  });

  test('an incomplete contract exits 1 and explains why', () => {
    const result = run(['validate', 'FEAT-9402']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /INCOMPLETE/);
    assert.match(result.stdout, /Ambiguity Log/);
  });

  test('a missing contract exits 2', () => {
    const result = run(['validate', 'FEAT-0000']);
    assert.strictEqual(result.code, 2);
  });
});

describe('CLI — new', () => {
  test('new creates a contract and prints its ID', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-new-'));
    try {
      const result = run(['new', 'Notificaciones por email', '--type', 'FEAT'], { cwd: root });
      assert.strictEqual(result.code, 0);
      assert.match(result.stdout, /FEAT-0001/);
      assert.ok(fs.existsSync(path.join(root, 'contracts', 'FEAT-0001.md')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('new without a title exits 2', () => {
    const result = run(['new']);
    assert.strictEqual(result.code, 2);
  });
});

describe('CLI — next', () => {
  test('next suggests validating the pending draft', () => {
    const result = run(['next', '--json']);
    assert.strictEqual(result.code, 0);

    const data = JSON.parse(result.stdout);
    const commands = data.next.map(step => step.command).join(' ');
    assert.match(commands, /validate FEAT-9402|validate FIX-9401/);
  });
});

describe('CLI — report', () => {
  test('report renders the map, the runs and a verdict', () => {
    const result = run(['report', 'FEAT-9403']);
    assert.strictEqual(result.code, 0);

    assert.match(result.stdout, /# Informe de ejecución — FEAT-9403/);
    assert.match(result.stdout, /## Criterios/);
    assert.match(result.stdout, /## Ejecuciones registradas/);
    assert.match(result.stdout, /CLAIM/);
    assert.match(result.stdout, /COMPLETO/);
  });

  test('report --out writes the file instead of stdout', () => {
    const outFile = path.join(tempRoot, 'informe.md');
    const result = run(['report', 'FEAT-9403', '--out', outFile]);

    assert.strictEqual(result.code, 0);
    assert.ok(fs.existsSync(outFile));
    assert.match(fs.readFileSync(outFile, 'utf8'), /# Informe de ejecución — FEAT-9403/);
  });

  test('report of a contract with pending items exits 1', () => {
    const result = run(['report', 'FIX-9401']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /PENDIENTE/);
  });
});

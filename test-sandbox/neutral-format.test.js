/**
 * Neutral contract format — the core must not depend on one language, one file
 * naming convention or one ID prefix.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-neutral-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall } = require('../mcp/server.js');

const contractsDir = path.join(tempRoot, 'contracts');

function reset() {
  fs.rmSync(contractsDir, { recursive: true, force: true });
  fs.mkdirSync(contractsDir, { recursive: true });
}

function write(fileName, content) {
  fs.writeFileSync(path.join(contractsDir, fileName), content, 'utf8');
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('Neutral format — sections in Spanish', () => {
  test('a contract with Spanish headings validates as READY', () => {
    reset();
    write('FIX-9301.md', `# CONTRACT: Formato en español
# ID: FIX-9301
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error
## Pasos
1. Se reproduce el error.
2. Se corrigen las líneas afectadas.
3. Se verifica que el error desaparece.

## Criterios de Aceptación
- AC-001: GIVEN un caso WHEN se ejecuta THEN no hay error

## Registro de Ambigüedades
- [x] Ninguna
`);

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FIX-9301' });

    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
    assert.strictEqual(result.type, 'fix');
    assert.deepStrictEqual(result.missing, []);
  });

  test('a contract with English headings still validates', () => {
    reset();
    write('FEAT-9302.md', `# CONTRACT: English format
# ID: FEAT-9302
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error
### Main Flow
1. One step.
2. Two steps.
3. Three steps.

### Alternative Flows
- AF-01: condition -> result

## Business Rules
- BR-001: invariant

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c

## Ambiguity Log
- [x] None
`);

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9302' });

    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
    assert.strictEqual(result.type, 'feature');
  });
});

describe('Neutral format — type and file naming', () => {
  test('a non-standard file name is resolved by contract ID', () => {
    reset();
    write('02-FIX-9303-sdd-gl-ci-verde.md', `# CONTRACT: Nombre de campaña
# ID: FIX-9303
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
`);

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FIX-9303' });

    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
    assert.strictEqual(result.contract_file, '02-FIX-9303-sdd-gl-ci-verde.md');
    assert.strictEqual(result.type, 'fix');
  });

  test('front-matter type wins over the ID prefix', () => {
    reset();
    write('FEAT-9304.md', `---
type: fix
---
# CONTRACT: Front matter manda
# ID: FEAT-9304
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
`);

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9304' });

    assert.strictEqual(result.type, 'fix');
    assert.strictEqual(result.is_fix, true);
    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
  });

  test('a FIX is not required to declare Business Rules', () => {
    reset();
    write('FIX-9305.md', `# CONTRACT: Sin reglas
# ID: FIX-9305
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
`);

    const result = handleToolCall('sdd_validate_gate', { contract_id: 'FIX-9305' });

    assert.ok(!result.missing.some(issue => /Business Rules/.test(issue)));
    assert.strictEqual(result.status, 'READY_FOR_APPROVAL');
  });
});

describe('Read-only tools never create project state', () => {
  test('every read-only tool leaves an empty directory untouched', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-readonly-'));
    const script = `
      const { handleToolCall } = require(${JSON.stringify(path.join(__dirname, '..', 'mcp', 'server.js'))});
      handleToolCall('sdd_get_status', {});
      handleToolCall('sdd_get_metrics', {});
      handleToolCall('sdd_audit_traceability', {});
      handleToolCall('sdd_validate_gate', { contract_id: 'FEAT-9999' });
    `;

    try {
      const { spawnSync } = require('node:child_process');
      const run = spawnSync(process.execPath, ['-e', script], {
        cwd: emptyRoot,
        env: { ...process.env, SDD_PROJECT_ROOT: emptyRoot, SDD_TELEMETRY: 'off' },
        encoding: 'utf8'
      });

      assert.strictEqual(run.status, 0, run.stderr);
      const entries = fs.readdirSync(emptyRoot);
      assert.deepStrictEqual(entries, [], `read-only tools created: ${entries.join(', ')}`);
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test('a write tool does create the project structure', () => {
    const writeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-writable-'));
    const script = `
      const { handleToolCall } = require(${JSON.stringify(path.join(__dirname, '..', 'mcp', 'server.js'))});
      handleToolCall('sdd_create_contract', { title: 'Algo', type: 'FEAT' });
    `;

    try {
      const { spawnSync } = require('node:child_process');
      const run = spawnSync(process.execPath, ['-e', script], {
        cwd: writeRoot,
        env: { ...process.env, SDD_PROJECT_ROOT: writeRoot },
        encoding: 'utf8'
      });

      assert.strictEqual(run.status, 0, run.stderr);
      assert.ok(fs.existsSync(path.join(writeRoot, 'contracts')), 'write path must create contracts/');
      assert.ok(fs.existsSync(path.join(writeRoot, '.sdd')), 'write path must create .sdd/');
    } finally {
      fs.rmSync(writeRoot, { recursive: true, force: true });
    }
  });
});

/**
 * ID Generation & Non-Destructive Suite Tests (FEAT-0006)
 *
 * Cubre los criterios funcionales del Contract FEAT-0006:
 *   AC-001..AC-006, AF-01, AF-02, AF-03, BR-001..BR-005.
 *
 * AISLAMIENTO (BR-003, crítico): `process.env.SDD_PROJECT_ROOT` se apunta a un
 * directorio temporal único ANTES de `require('../mcp/server.js')`, porque el
 * módulo resuelve PROJECT_ROOT/CONTRACTS_DIR en tiempo de carga. Así, TODO
 * `handleToolCall` escribe dentro del directorio temporal y JAMÁS en
 * `contracts/` del repositorio real.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gl-idtest-'));
process.env.SDD_PROJECT_ROOT = tmpRoot;

const { test, after } = require('node:test');
const assert = require('node:assert');

// Requerido DESPUÉS de fijar SDD_PROJECT_ROOT (ver AISLAMIENTO en la cabecera).
const { handleToolCall, computeNextContractId } = require('../mcp/server.js');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const TMP_CONTRACTS_DIR = path.join(tmpRoot, 'contracts');

// BR-003 / AC-003: snapshot del contracts/ REAL antes de cualquier handleToolCall.
const contractsSnapshotBefore = fs.readdirSync(REAL_CONTRACTS_DIR).sort();

// Resultado de la última creación (usado por la aserción de aislamiento BR-003/AC-003).
let lastCreateData = null;

// Limpieza del directorio temporal al finalizar toda la suite.
after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// AC-001: assertion:FEAT-0006-ac001
test('AC-001: GIVEN FEAT-0003/0004/0005/9999 WHEN se crea un FEAT THEN el ID resultante es FEAT-0006', () => {
  const files = ['FEAT-0003.md', 'FEAT-0004.md', 'FEAT-0005.md', 'FEAT-9999.md'];
  assert.strictEqual(computeNextContractId(files, 'FEAT'), 'FEAT-0006');
});

// AC-004: assertion:FEAT-0006-ac004 | AF-01: unit-test:FEAT-0006-af01 | BR-004: unit-test:FEAT-0006-br004
test('AC-004 / AF-01 / BR-004: el outlier FEAT-9999 no altera el próximo ID correlativo', () => {
  assert.strictEqual(computeNextContractId(['FEAT-0005.md', 'FEAT-9999.md'], 'FEAT'), 'FEAT-0006');
  // Solo el outlier presente: el correlativo arranca desde el primer ID.
  assert.strictEqual(computeNextContractId(['FEAT-9999.md'], 'FEAT'), 'FEAT-0001');
});

// AF-03: unit-test:FEAT-0006-af03
test('AF-03: GIVEN contracts/ vacío WHEN se calcula el próximo ID THEN es FEAT-0001', () => {
  assert.strictEqual(computeNextContractId([], 'FEAT'), 'FEAT-0001');
});

// BR-001: unit-test:FEAT-0006-br001
test('BR-001: el próximo ID es max+1 (nunca count+1), tolera gaps, tipos ajenos y desorden', () => {
  // Gap 1..7 con solo 2 archivos: max+1 = 8 (count+1 daría 3).
  assert.strictEqual(computeNextContractId(['FEAT-0001.md', 'FEAT-0007.md'], 'FEAT'), 'FEAT-0008');
  // Los archivos de otro tipo no participan del cómputo del tipo pedido.
  assert.strictEqual(computeNextContractId(['FIX-0001.md'], 'FIX'), 'FIX-0002');
  // El orden de entrada no altera el resultado (max, no último elemento).
  assert.strictEqual(computeNextContractId(['FEAT-0009.md', 'FEAT-0002.md'], 'FEAT'), 'FEAT-0010');
});

// BR-002: unit-test:FEAT-0006-br002 | AC-002: assertion:FEAT-0006-ac002 | AF-02: unit-test:FEAT-0006-af02
// Verificación conductual de no-sobrescritura: el handler `sdd_create_contract`
// NO acepta un parámetro `id` (inputSchema: title/type/gate_mode/intent), por lo
// que la invariante observable de BR-002 ("jamás sobrescribir un .md existente")
// es que creaciones sucesivas nunca destruyen el archivo del contrato previo.
test('BR-002 / AC-002 / AF-02: creaciones sucesivas nunca sobrescriben el contrato previo', () => {
  const first = handleToolCall('sdd_create_contract', { title: 'T1', type: 'FEAT' });
  assert.strictEqual(first.success, true);
  assert.strictEqual(first.contract_id, 'FEAT-0001');
  lastCreateData = first;

  const firstPath = path.join(TMP_CONTRACTS_DIR, 'FEAT-0001.md');
  const firstContent = fs.readFileSync(firstPath, 'utf8');

  const second = handleToolCall('sdd_create_contract', { title: 'T2', type: 'FEAT' });
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.contract_id, 'FEAT-0002'); // creó el SIGUIENTE, no el mismo ID
  lastCreateData = second;

  // FEAT-0001.md permanece idéntico (string compare) tras la segunda creación.
  assert.strictEqual(fs.readFileSync(firstPath, 'utf8'), firstContent);
  assert.ok(fs.existsSync(path.join(TMP_CONTRACTS_DIR, 'FEAT-0002.md')));
});

// NOTA (AC-002 / AF-02, rama directa de la guarda): la guarda `fs.existsSync`
// (mcp/server.js) no es alcanzable de forma determinista vía la API pública:
// el ID siempre se deriva del MISMO readdirSync sobre el que se calcula max+1,
// por lo que el destino calculado jamás preexiste en el listing (es defensa
// anti-carrera). Por eso AC-002/AF-02 se verifican conductualmente en el test
// anterior, única invariante observable sin parámetro `id`.

// BR-003: unit-test:FEAT-0006-br003 | AC-003: assertion:FEAT-0006-ac003
// Los tests no tocan contracts/ real: snapshot ANTES (capturado al cargar el módulo)
// vs DESPUÉS de todos los handleToolCall del archivo (este test se declara después
// de todo test que invoca handleToolCall; node:test ejecuta secuencial por defecto).
test('BR-003 / AC-003: la suite no modifica contracts/ real y createData.path vive en el tmp root', () => {
  assert.ok(Array.isArray(contractsSnapshotBefore) && contractsSnapshotBefore.length > 0);

  // Todo handleToolCall del archivo escribió en el tmp root, no en el repo.
  assert.ok(fs.existsSync(path.join(TMP_CONTRACTS_DIR, 'FEAT-0001.md')));
  assert.ok(fs.existsSync(path.join(TMP_CONTRACTS_DIR, 'FEAT-0002.md')));

  const contractsSnapshotAfter = fs.readdirSync(REAL_CONTRACTS_DIR).sort();
  assert.deepStrictEqual(contractsSnapshotAfter, contractsSnapshotBefore);

  // El path del contrato creado queda dentro del tmp root y FUERA del repo real.
  assert.ok(lastCreateData, 'se requiere al menos un sdd_create_contract previo');
  const resolvedPath = path.resolve(lastCreateData.path);
  assert.ok(
    resolvedPath.startsWith(path.resolve(tmpRoot) + path.sep),
    `createData.path debe estar dentro del tmp root (${tmpRoot}): ${lastCreateData.path}`
  );
  assert.ok(
    !resolvedPath.startsWith(path.resolve(REPO_ROOT) + path.sep),
    `createData.path NO debe estar dentro del repo real (${REPO_ROOT}): ${lastCreateData.path}`
  );
});

// AC-005: assertion:FEAT-0006-ac005 (estado del repo: FEAT-0005 restaurado)
test('AC-005: GIVEN contracts/FEAT-0005.md WHEN se lee THEN contiene Living Visual Dashboard en Status: RESOLVED', () => {
  const content = fs.readFileSync(path.join(REAL_CONTRACTS_DIR, 'FEAT-0005.md'), 'utf8');
  assert.ok(content.includes('Living Visual Dashboard'), 'FEAT-0005 debe describir el Living Visual Dashboard');
  assert.ok(content.includes('# Status: RESOLVED'), 'FEAT-0005 debe estar en Status: RESOLVED');
});

// AC-006: assertion:FEAT-0006-ac006 | BR-005: unit-test:FEAT-0006-br005 (estado del repo)
test('AC-006 / BR-005: contracts/FEAT-0003.md no existe y ningún ID de contrato está duplicado', () => {
  assert.strictEqual(
    fs.existsSync(path.join(REAL_CONTRACTS_DIR, 'FEAT-0003.md')),
    false,
    'el placeholder huérfano FEAT-0003.md debió eliminarse'
  );

  const ids = fs
    .readdirSync(REAL_CONTRACTS_DIR)
    .filter(file => /^(FEAT|FIX)-(\d+)\.md$/.test(file))
    .map(file => file.replace(/\.md$/, ''));
  assert.ok(ids.length > 0, 'deben existir contratos parseables en contracts/');
  assert.strictEqual(
    new Set(ids).size,
    ids.length,
    `IDs de contrato duplicados detectados: ${ids.join(', ')}`
  );
});

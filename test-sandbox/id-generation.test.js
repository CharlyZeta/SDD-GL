/**
 * ID Generation & Non-Destructive Suite Tests (FEAT-0006) + Privacy Policy (FEAT-0012)
 *
 * Cubre los criterios funcionales del Contract FEAT-0006:
 *   AC-001..AC-006, AF-01, AF-02, AF-03, BR-001..BR-005.
 *
 * Cubre además los invariantes de política de privacidad del Contract FEAT-0012:
 *   - contracts/ (specs de trabajo y roadmap) y .sdd/ (auditorías Glass Box)
 *     permanecen privados: gitignored, único trackeado contracts/.gitkeep.
 *   - El showcase curado vive en examples/contracts/ (trackeado y público:
 *     FEAT-0004.md, FEAT-0005.md, FEAT-9999.md).
 *   - Ningún roadmap activo (FEAT-0006..FEAT-0011) ni auditoría .sdd/ está
 *     publicado en el índice ni en el historial local.
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
const { execSync } = require('child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gl-idtest-'));
process.env.SDD_PROJECT_ROOT = tmpRoot;

const { test, after } = require('node:test');
const assert = require('node:assert');

// Requerido DESPUÉS de fijar SDD_PROJECT_ROOT (ver AISLAMIENTO en la cabecera).
const { handleToolCall, computeNextContractId } = require('../mcp/server.js');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const SHOWCASE_DIR = path.join(REPO_ROOT, 'examples', 'contracts'); // FEAT-0012: showcase público
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

// AC-005: assertion:FEAT-0006-ac005 (estado del repo: showcase FEAT-0005 re-apuntado
// a examples/contracts/ según la política de privacidad de FEAT-0012)
test('AC-005: GIVEN examples/contracts/FEAT-0005.md WHEN se lee THEN contiene Living Visual Dashboard en Status: RESOLVED', () => {
  const content = fs.readFileSync(path.join(SHOWCASE_DIR, 'FEAT-0005.md'), 'utf8');
  assert.ok(content.includes('Living Visual Dashboard'), 'FEAT-0005 debe describir el Living Visual Dashboard');
  assert.ok(content.includes('# Status: RESOLVED'), 'FEAT-0005 debe estar en Status: RESOLVED');
});

// AC-006: assertion:FEAT-0006-ac006 | BR-005: unit-test:FEAT-0006-br005 (estado del repo)
// FEAT-0012: los showcase viven ahora en examples/contracts/, por lo que la ausencia
// del placeholder FEAT-0003 y la unicidad de IDs se verifican sobre la UNIÓN de
// contracts/ (trabajo local) y examples/contracts/ (showcase público).
test('AC-006 / BR-005: FEAT-0003.md no existe (ni en contracts/ ni en examples/contracts/) y ningún ID de contrato está duplicado en la unión', () => {
  assert.strictEqual(
    fs.existsSync(path.join(REAL_CONTRACTS_DIR, 'FEAT-0003.md')),
    false,
    'el placeholder huérfano FEAT-0003.md debió eliminarse'
  );
  assert.strictEqual(
    fs.existsSync(path.join(SHOWCASE_DIR, 'FEAT-0003.md')),
    false,
    'FEAT-0003.md no debe existir en el showcase público'
  );

  const ids = [REAL_CONTRACTS_DIR, SHOWCASE_DIR]
    .flatMap(dir => fs.readdirSync(dir))
    .filter(file => /^(FEAT|FIX)-(\d+)\.md$/.test(file))
    .map(file => file.replace(/\.md$/, ''));
  // En un clon nuevo contracts/ puede no aportar ningún .md de contrato (solo
  // .gitkeep): la población la garantiza el showcase (3 contratos), por eso el
  // assertion de no-vacío se evalúa sobre la unión de ambos directorios.
  assert.ok(ids.length > 0, 'deben existir contratos parseables en contracts/ + examples/contracts/');
  assert.strictEqual(
    new Set(ids).size,
    ids.length,
    `IDs de contrato duplicados detectados: ${ids.join(', ')}`
  );
});

// ============================================================================
// FEAT-0012 — Política de privacidad: contracts/ y .sdd/ privados, showcase
// público en examples/contracts/. Los comandos git aquí usados son de SOLO
// LECTURA (ls-files / log) y no mutan el índice ni la historia.
// ============================================================================

// Ejecuta un comando git de solo lectura en la raíz del repo:
// stdin ignorado, stdout capturado, stderr ignorado.
const git = args =>
  execSync(`git ${args}`, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

const GITIGNORE_CONTENT = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');

// BR-001: unit-test:FEAT-0012-br001 | AC-001: assertion:FEAT-0012-ac001
test('FEAT-0012 BR-001 / AC-001: .gitignore ignora contracts/ y .sdd/ y solo contracts/.gitkeep queda trackeado', () => {
  assert.ok(GITIGNORE_CONTENT.includes('contracts/*'), '.gitignore debe contener la entrada contracts/*');
  assert.ok(GITIGNORE_CONTENT.includes('!contracts/.gitkeep'), '.gitignore debe re-incluir !contracts/.gitkeep');
  assert.ok(GITIGNORE_CONTENT.includes('.sdd/'), '.gitignore debe contener la entrada .sdd/');

  const tracked = git('ls-files contracts .sdd').trim();
  assert.strictEqual(
    tracked,
    'contracts/.gitkeep',
    `el único archivo trackeado en contracts/ y .sdd/ debe ser contracts/.gitkeep; se obtuvo: ${tracked}`
  );
});

// AC-002: assertion:FEAT-0012-ac002 | BR-002: unit-test:FEAT-0012-br002
test('FEAT-0012 AC-002 / BR-002: examples/contracts/ contiene exactamente los 3 showcase (FEAT-0004, FEAT-0005, FEAT-9999)', () => {
  const files = fs.readdirSync(SHOWCASE_DIR).sort();
  assert.deepStrictEqual(
    files,
    ['FEAT-0004.md', 'FEAT-0005.md', 'FEAT-9999.md'],
    `examples/contracts/ debe contener exactamente el showcase curado; se obtuvo: ${files.join(', ')}`
  );
});

// AF-01: unit-test:FEAT-0012-af01 | AC-003: assertion:FEAT-0012-ac003
// Resiliencia a clon nuevo: todo lo que los tests de estado leen (los showcase de
// examples/contracts/) está trackeado, y contracts/ no aporta contenido del que
// la suite dependa (solo .gitkeep).
test('FEAT-0012 AF-01 / AC-003: en un clon nuevo, todo lo que leen los tests de estado está trackeado', () => {
  const showcaseTracked = git('ls-files examples/contracts').trim().split(/\r?\n/).sort();
  assert.deepStrictEqual(
    showcaseTracked,
    ['examples/contracts/FEAT-0004.md', 'examples/contracts/FEAT-0005.md', 'examples/contracts/FEAT-9999.md'],
    `los 3 showcase deben estar trackeados en examples/contracts/; se obtuvo: ${showcaseTracked.join(', ')}`
  );

  const contractsTracked = git('ls-files contracts').trim();
  assert.strictEqual(
    contractsTracked,
    'contracts/.gitkeep',
    `contracts/ solo debe trackear .gitkeep (los tests de estado no dependen de contenido no-trackeado); se obtuvo: ${contractsTracked}`
  );
});

// BR-003: unit-test:FEAT-0012-br003 | AC-004: assertion:FEAT-0012-ac004
test('FEAT-0012 BR-003 / AC-004: ningún roadmap activo (contracts/FEAT|FIX-*.md) ni auditoría .sdd/ fue publicado', () => {
  // a) El índice del repo no trackea ningún contrato de trabajo ni ruta de .sdd/.
  const allTracked = git('ls-files').trim().split(/\r?\n/);
  const leaked = allTracked.filter(
    p => /^contracts\/(FEAT|FIX)-\d+\.md$/.test(p) || /^\.sdd\//.test(p)
  );
  assert.deepStrictEqual(
    leaked,
    [],
    `no debe haber rutas privadas trackeadas; se detectaron: ${leaked.join(', ')}`
  );

  // b) contracts/FEAT-0006.md nunca fue commiteado en ninguna rama local.
  const log = git('log --all --format=%h -- contracts/FEAT-0006.md').trim();
  assert.strictEqual(
    log,
    '',
    'contracts/FEAT-0006.md (roadmap activo) no debe aparecer en el historial de ninguna rama local'
  );
});

// NOT_WRITABLE (FEAT-0012):
// - BR-004 (suite completa en verde): no es una aserción unitaria de este archivo;
//   se verifica ejecutando la suite completa (npm test) dentro del Loop.
// - BR-005 (no-rewrite de la historia ya publicada de los showcase): su
//   verificación corresponde al orquestador (sin purge/rebase); no es una
//   invariante unit-testeable aquí.

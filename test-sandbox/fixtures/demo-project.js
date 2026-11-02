#!/usr/bin/env node

/**
 * Fixture project builder — reproducible from the repository.
 *
 * Creates a throw-away project that exercises the edge cases of SDD-GL:
 * DRAFT/APPROVED/RESOLVED contracts, Spanish headings, campaign-style file
 * names, front-matter type, waivers, contradictions, budget overflow,
 * dependencies (satisfied and pending), 4- and 5-column maps, interrupted
 * items, and MCP + CLI telemetry.
 *
 * Usage:
 *   node test-sandbox/fixtures/demo-project.js [targetDir]
 *
 * Without a target it builds into a temporary directory and prints its path.
 * The generated project is never committed: it is a fixture, not source.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'sdd.js');
const SERVER = path.join(REPO_ROOT, 'mcp', 'server.js');
const DASHBOARD = path.join(REPO_ROOT, 'mcp', 'dashboard-gen.js');

function map5(rows) {
  return ['# [item-id]|[layer]|[test-id]|[agente]|[status]', ...rows].join('\n');
}

const CONTRACTS = {
  'FEAT-0001-catalogo.md': `# CONTRACT: Catálogo con filtros combinados
# ID: FEAT-0001
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Intent
Permitir combinar filtros de categoría, precio y disponibilidad sin recargar la página.

## User Story
- Como: comprador
- Quiero: combinar filtros y ver resultados al instante
- Para: encontrar el producto sin recorrer todo el catálogo

## Use Case
**Actor:** Comprador
**Goal:** Filtrar el catálogo por varios criterios a la vez

### Pasos
### 1. El comprador abre el catálogo.
### 2. Aplica categoría y rango de precio.
### 3. El listado se recalcula sin recargar.
### 4. Se muestra cuántos productos coinciden.
### 5. El comprador puede limpiar todos los filtros.

### Flujos Alternativos
- AF-01: ningún producto coincide → estado vacío con sugerencia de limpiar filtros
- AF-02: el comprador recarga la página → los filtros se conservan en la URL

## Reglas de Negocio
- BR-001: el rango de precio no admite mínimo mayor que máximo
- BR-002: los filtros se reflejan en la URL para poder compartirla
- BR-003: el conteo de resultados siempre coincide con las tarjetas visibles

## Criterios de Aceptación
- AC-001: GIVEN el catálogo WHEN se aplica un filtro THEN el listado y el conteo se actualizan juntos
- AC-002: GIVEN filtros activos WHEN se recarga THEN el estado se restaura desde la URL
- AC-003: GIVEN ningún resultado WHEN se filtra THEN se muestra el estado vacío

## Entities Affected
- \`src/catalog/filters.ts\`

## Inferred Assumptions
- [ ] AS-01: los filtros se combinan con AND, no con OR → si es falso, hay que agregar un selector de operador

## Registro de Ambigüedades
- [x] Ninguna
`,

  'FEAT-0002.md': `# CONTRACT: Checkout con cupones de descuento
# ID: FEAT-0002
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Aplicar cupones porcentuales y de monto fijo en el checkout, validando vigencia y tope.

## User Story
- Como: comprador
- Quiero: aplicar un cupón y ver el total actualizado
- Para: pagar el precio correcto

## Use Case
**Actor:** Comprador
**Goal:** Aplicar un cupón antes de pagar

### Main Flow
1. El comprador ingresa el código en el carrito.
2. El sistema valida vigencia, tope y usos.
3. El total se recalcula sobre el subtotal.
4. El comprador confirma y se registra el uso.

### Alternative Flows
- AF-01: cupón vencido → se rechaza y el total no cambia
- AF-02: tope superado → el descuento se limita al subtotal

## Business Rules
- BR-001: el descuento nunca supera el subtotal
- BR-002: el cupón porcentual usa el subtotal previo a impuestos
- BR-003: no se combinan dos cupones en un pedido

## Acceptance Criteria
- AC-001: GIVEN un cupón del 10% WHEN se aplica THEN el total baja un 10% del subtotal
- AC-002: GIVEN un cupón mayor al subtotal WHEN se aplica THEN el total queda en cero
- AC-003: GIVEN un cupón ya usado WHEN se aplica THEN se rechaza con motivo

## Entities Affected
- \`src/checkout/cart.ts\`

## Completion Map
${map5([
  '# Main Flow | functional | functional-tests:FEAT-0002-main | tester | ✅',
  '# Main Flow | static | static-analysis:FEAT-0002-main | verifier | ✅',
  '# Main Flow | security | security-scan:FEAT-0002-main | verifier | ✅',
  '# Main Flow | arch | arch-guard:FEAT-0002-main | verifier | ❌',
  '# AF-01 | functional | unit-test:FEAT-0002-af01 | tester | ✅',
  '# AF-02 | functional | unit-test:FEAT-0002-af02 | tester | ✅',
  '# BR-001 | functional | unit-test:FEAT-0002-br001 | tester | ✅',
  '# BR-002 | functional | unit-test:FEAT-0002-br002 | tester | ✅',
  '# BR-003 | functional | unit-test:FEAT-0002-br003 | tester | ⏳',
  '# AC-001 | functional | assertion:FEAT-0002-ac001 | tester | ✅',
  '# AC-002 | functional | assertion:FEAT-0002-ac002 | tester | ❌',
  '# AC-003 | functional | assertion:FEAT-0002-ac003 | tester | ❌'
])}
`,

  'FEAT-0003.md': `---
depends_on: FEAT-0002
---
# CONTRACT: Historial de pedidos del cliente
# ID: FEAT-0003
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Mostrar al cliente sus pedidos anteriores con estado y total.

## User Story
- Como: comprador
- Quiero: ver mi historial de pedidos
- Para: repetir una compra o revisar un cobro

## Use Case
**Actor:** Comprador
**Goal:** Consultar pedidos anteriores

### Main Flow
1. El comprador abre su cuenta.
2. El sistema lista los pedidos por fecha.
3. Cada pedido muestra estado, total y detalle.

### Alternative Flows
- AF-01: sin pedidos → estado vacío con llamada a la acción

## Business Rules
- BR-001: el historial solo muestra pedidos del propio cliente
- BR-002: el total mostrado coincide con el cobrado

## Acceptance Criteria
- AC-001: GIVEN un cliente con pedidos WHEN abre el historial THEN los ve ordenados por fecha
- AC-002: GIVEN un cliente sin pedidos WHEN abre el historial THEN ve el estado vacío

## Entities Affected
- \`src/orders/history.ts\`
`,

  'FEAT-0004.md': `# CONTRACT: Búsqueda con tolerancia a errores
# ID: FEAT-0004
# Status: RESOLVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## Intent
Sugerir resultados aunque el término tenga errores de tipeo.

## User Story
- Como: comprador
- Quiero: encontrar productos aunque escriba mal
- Para: no abandonar la búsqueda

## Use Case
**Actor:** Comprador
**Goal:** Obtener resultados con tolerancia a errores

### Main Flow
1. El comprador escribe en el buscador.
2. El sistema normaliza el término.
3. Se buscan coincidencias exactas y aproximadas.
4. Se ordenan por relevancia.

### Alternative Flows
- AF-01: sin coincidencias → se sugiere corregir el término

## Business Rules
- BR-001: la búsqueda aproximada no supera 2 ediciones
- BR-002: los resultados exactos siempre van primero

## Acceptance Criteria
- AC-001: GIVEN un término con una letra cambiada WHEN se busca THEN aparece el producto esperado
- AC-002: GIVEN un término sin coincidencias WHEN se busca THEN se sugiere corrección

## Entities Affected
- \`src/search/index.ts\`

## Completion Map
${map5([
  '# Main Flow | functional | functional-tests:FEAT-0004-main | tester | ✅',
  '# Main Flow | static | static-analysis:FEAT-0004-main | verifier | ✅',
  '# Main Flow | security | security-scan:FEAT-0004-main | verifier | ✅',
  '# Main Flow | arch | arch-guard:FEAT-0004-main | verifier | ✅',
  '# AF-01 | functional | unit-test:FEAT-0004-af01 | tester | ✅',
  '# BR-001 | functional | unit-test:FEAT-0004-br001 | tester | ✅',
  '# BR-002 | functional | unit-test:FEAT-0004-br002 | tester | ✅',
  '# AC-001 | functional | assertion:FEAT-0004-ac001 | tester | ✅',
  '# AC-002 | functional | assertion:FEAT-0004-ac002 | tester | ✅'
])}
`,

  'FEAT-0005.md': `# CONTRACT: Límite de descuento por campaña
# ID: FEAT-0005
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Intent
Aplicar un tope de descuento por campaña.

## User Story
- Como: responsable de marketing
- Quiero: definir un tope de descuento
- Para: proteger el margen

## Use Case
**Actor:** Marketing
**Goal:** Configurar el tope por campaña

### Main Flow
1. Marketing define el porcentaje máximo.
2. El sistema lo guarda por campaña.
3. El checkout lo aplica.

### Alternative Flows
- AF-01: tope inválido → se rechaza la configuración

## Business Rules
- BR-001: monto > 0 en toda campaña
- BR-002: el tope no puede superar el 40%

## Acceptance Criteria
- AC-001: GIVEN una campaña WHEN se guarda monto = 0 THEN se acepta como campaña sin descuento
- AC-002: GIVEN un tope del 60% WHEN se guarda THEN se rechaza

## Entities Affected
- \`src/marketing/campaigns.ts\`
`,

  'FEAT-0006.md': `# CONTRACT: Facturación electrónica
# ID: FEAT-0006
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Intent
Emitir facturas electrónicas con los datos fiscales del pedido.

## User Story
- Como: administrador
- Quiero: emitir la factura del pedido
- Para: cumplir con la obligación fiscal

## Use Case
**Actor:** Administrador
**Goal:** Emitir y descargar la factura

### Main Flow
1. Se confirma el pedido.
2. Se generan los datos fiscales.
3. Se emite el comprobante.
4. Se envía por email.

### Alternative Flows
- AF-01: datos fiscales incompletos → se solicita completarlos

## Business Rules
- BR-001: la factura incluye el IVA discriminado
- BR-002: el número de comprobante es correlativo y único
- BR-003: la factura no se emite dos veces para el mismo pedido
- BR-004: los datos fiscales se validan contra el padrón
- BR-005: el comprobante se conserva diez años
- BR-006: el envío por email no bloquea la emisión
- BR-007: la anulación requiere nota de crédito
- BR-008: el total de la factura coincide con el cobrado

## Acceptance Criteria
- AC-001: GIVEN un pedido confirmado WHEN se factura THEN el comprobante incluye IVA discriminado
- AC-002: GIVEN dos pedidos WHEN se facturan THEN los números son correlativos
- AC-003: GIVEN una factura emitida WHEN se reintenta THEN no se duplica

## Entities Affected
- \`src/billing/invoice.ts\`
`,

  '02-FIX-0001-redondeo.md': `---
type: fix
---
# CONTRACT: Redondeo incorrecto en el total del carrito
# ID: FIX-0001
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Corregir el redondeo a dos decimales para que el total mostrado coincida con el cobrado.

## User Story
- Como: comprador
- Quiero: que el total mostrado sea el cobrado
- Para: no pagar de más

## Use Case
**Actor:** Comprador
**Goal:** Pagar exactamente lo que ve

### Pasos
### 1. Se calcula el total con impuestos.
### 2. Se aplica redondeo bancario a dos decimales.
### 3. Se envía el monto al proveedor de pagos.

### Flujos Alternativos
- AF-01: diferencia detectada en la confirmación → se registra una alerta

## Criterios de Aceptación
- AC-001: GIVEN un carrito de 99.995 WHEN se calcula THEN el total es 100.00
- AC-002: GIVEN un carrito de 0.015 WHEN se calcula THEN el redondeo es 0.02
- AC-003: GIVEN una diferencia entre mostrado y cobrado WHEN se detecta THEN se emite alerta

## Entidades Afectadas
- \`src/checkout/rounding.ts\`
`,

  'FIX-0002.md': `# CONTRACT: Reintentos del proveedor de email
# ID: FIX-0002
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Evitar que un fallo del proveedor de email pierda la notificación del pedido.

## Use Case
**Actor:** Servicio de pagos
**Goal:** Reintentar sin bloquear la respuesta

## Pasos
1. El envío falla con 5xx.
2. Se reprograma con backoff exponencial.
3. Se registra la causa del fallo.

## Alternative Flows
- AF-01: se agotan los reintentos → se alerta al equipo

## Business Rules
- BR-001: el reintento no bloquea la respuesta al cliente
- BR-002: todo reintento queda registrado con su causa
- BR-003: el email no incluye datos de tarjeta
- BR-004: el backoff parte de 30 segundos y duplica
- BR-005: se reintenta como máximo cinco veces
- BR-006: el asunto incluye el número de pedido
- BR-007: el cuerpo no supera 100 KB
- BR-008: el proveedor se elige por configuración

## Acceptance Criteria
- AC-001: GIVEN un fallo 5xx WHEN se envía THEN se reintenta con backoff
- AC-002: GIVEN cinco fallos WHEN se agota THEN se alerta al equipo

## Ambiguity Log
- [x] STORY-OK: el fix nace de una incidencia, no de una historia de producto
- [x] BUDGET-OK: las ocho reglas son del proveedor y no se pueden dividir
`,

  'FIX-0003.md': `# CONTRACT: Cupón duplicado en el carrito
# ID: FIX-0003
# Status: RESOLVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## Intent
Evitar que el mismo cupón se aplique dos veces al recargar el carrito.

## User Story
- Como: comprador
- Quiero: que el cupón se aplique una sola vez
- Para: no perder el descuento ni duplicarlo

## Use Case
**Actor:** Comprador
**Goal:** Aplicar el cupón una única vez

### Pasos
1. El comprador aplica el cupón.
2. Recarga la página.
3. El sistema restaura el estado del carrito.

### Flujos Alternativos
- AF-01: cupón ya aplicado → se ignora el segundo intento

## Criterios de Aceptación
- AC-001: GIVEN un cupón aplicado WHEN se recarga THEN el descuento aparece una sola vez
- AC-002: GIVEN un cupón aplicado dos veces WHEN se confirma THEN el total no cambia

## Completion Map
# [item-id]|[test-id]|[agente]|[status]
# Main Flow | functional-tests:FIX-0003-main | tester | ✅
# AF-01 | unit-test:FIX-0003-af01 | tester | ✅
# AC-001 | assertion:FIX-0003-ac001 | tester | ✅
# AC-002 | assertion:FIX-0003-ac002 | tester | ✅
`,

  'FEAT-0007.md': `---
depends_on: FEAT-0004
---
# CONTRACT: Sugerencias de búsqueda personalizadas
# ID: FEAT-0007
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## Intent
Ordenar las sugerencias según el historial del cliente.

## User Story
- Como: comprador
- Quiero: sugerencias acordes a lo que ya busqué
- Para: encontrar más rápido lo que me interesa

## Use Case
**Actor:** Comprador
**Goal:** Ver sugerencias personalizadas

### Main Flow
1. El comprador escribe en el buscador.
2. Se consulta su historial reciente.
3. Las sugerencias se reordenan por afinidad.

### Alternative Flows
- AF-01: cliente nuevo → sugerencias globales

## Business Rules
- BR-001: el historial usado no expone datos de otros clientes
- BR-002: la personalización no altera los resultados exactos

## Acceptance Criteria
- AC-001: GIVEN un cliente con historial WHEN busca THEN las sugerencias se reordenan
- AC-002: GIVEN un cliente nuevo WHEN busca THEN ve sugerencias globales

## Entities Affected
- \`src/search/personalize.ts\`
`
};

const EDGE_CASES = [
  { id: 'FEAT-0001', expected: 'INCOMPLETE', why: 'open Inferred Assumption' },
  { id: 'FEAT-0005', expected: 'CONTRADICTION_DETECTED', why: 'BR monto > 0 vs AC monto = 0' },
  { id: 'FEAT-0006', expected: 'INCOMPLETE', why: 'BUDGET_EXCEEDED (8 BR)' },
  { id: 'FIX-0001', expected: 'READY_FOR_APPROVAL', why: 'campaign file name + front-matter type' },
  { id: 'FIX-0002', expected: 'READY_FOR_APPROVAL', why: 'STORY-OK and BUDGET-OK waivers' },
  { id: 'FEAT-0003', expected: 'READY_FOR_APPROVAL', why: 'gate passes; graph marks it blocked' }
];

function cli(root, args) {
  return spawnSync(process.execPath, [CLI, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: root }
  });
}

function write(root, file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

/**
 * Builds the fixture. Returns a summary with the project root and the
 * observed status of every edge case.
 */
function buildFixtureProject(targetDir) {
  const root = targetDir ? path.resolve(targetDir) : fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-fixture-'));
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  write(root, 'package.json', `${JSON.stringify({
    name: 'tienda-demo',
    version: '1.4.2',
    private: true,
    description: 'Fixture local para ejercitar SDD-GL de punta a punta',
    scripts: { test: 'node --test' }
  }, null, 2)}\n`);

  write(root, '.sdd/config.json', `${JSON.stringify({
    schema_version: 1,
    layers: ['functional', 'static', 'security', 'arch'],
    suite: 'npm test',
    suite_policy: 'on_resolve',
    timeout_seconds: 300
  }, null, 2)}\n`);

  for (const [file, content] of Object.entries(CONTRACTS)) {
    write(root, path.join('contracts', file), content);
  }

  // Gate: record the real verdict of every edge case (also produces CLI usage).
  const observed = EDGE_CASES.map(edge => {
    const result = cli(root, ['validate', edge.id]);
    const status = result.status;
    const output = `${result.stdout}${result.stderr}`;
    const expectedExit = edge.expected === 'READY_FOR_APPROVAL' ? 0 : 1;

    if (status !== expectedExit) {
      throw new Error(`fixture: ${edge.id} esperaba exit ${expectedExit}, obtuvo ${status}\n${output}`);
    }
    if (!output.includes(edge.expected)) {
      throw new Error(`fixture: ${edge.id} no reportó ${edge.expected}\n${output}`);
    }

    return { id: edge.id, expected: edge.expected, why: edge.why };
  });

  // Aprobaciones por CLI (dejan huella con hash del spec).
  for (const id of ['FEAT-0002', 'FEAT-0003', 'FEAT-0007']) {
    const result = cli(root, ['approve', id, '--yes']);
    if (result.status !== 0) throw new Error(`fixture: approve ${id} falló\n${result.stdout}${result.stderr}`);
  }

  // Loop real: un ítem por capa, un fallo, una reanudación y un ítem en curso.
  const steps = [
    ['loop', 'FEAT-0002', '--item', 'Main Flow', '--layer', 'arch'],
    ['loop', 'FEAT-0002', '--pass', '--item', 'Main Flow', '--layer', 'arch', '--evidence', 'arch-guard: límites OK'],
    ['loop', 'FEAT-0002', '--fail', '--item', 'AC-002', '--evidence', 'assertion: esperaba 0 y recibió -12.50'],
    ['loop', 'FEAT-0002', '--pass', '--item', 'BR-003', '--evidence', 'cupón único garantizado'],
    ['loop', 'FEAT-0002', '--item', 'AC-003']
  ];

  for (const args of steps) {
    const result = cli(root, args);
    const expected = args.includes('--fail') ? 1 : 0;
    if (result.status !== expected) {
      throw new Error(`fixture: ${args.join(' ')} esperaba exit ${expected}, obtuvo ${result.status}\n${result.stdout}${result.stderr}`);
    }
  }

  // Una sesión MCP real: sesiones, clientes declarados y llamadas por tool.
  const mcpScript = `
    const { spawn } = require('node:child_process');
    const server = spawn(process.execPath, [${JSON.stringify(SERVER)}], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, SDD_PROJECT_ROOT: ${JSON.stringify(root)} }
    });
    let buffer = '';
    let done = false;
    const send = (id, method, params) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n');
    server.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.includes('"serverInfo"') && !done) {
        done = true;
        send(2, 'tools/list');
        send(3, 'tools/call', { name: 'sdd_get_status', arguments: {} });
        send(4, 'tools/call', { name: 'sdd_get_metrics', arguments: {} });
        send(5, 'tools/call', { name: 'sdd_audit_traceability', arguments: {} });
        setTimeout(() => { server.kill(); process.exit(0); }, 700);
      }
    });
    send(1, 'initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'Claude Code', version: '2.1.0' } });
    setTimeout(() => { server.kill(); process.exit(0); }, 5000);
  `;
  spawnSync(process.execPath, ['-e', mcpScript], { cwd: root, encoding: 'utf8' });

  // Dashboard (local mode) para inspección visual o captura.
  const dash = spawnSync(process.execPath, ['-e', `
    const { generateDashboard } = require(${JSON.stringify(DASHBOARD)});
    console.log(JSON.stringify(generateDashboard(${JSON.stringify(root)})));
  `], { cwd: root, encoding: 'utf8', env: { ...process.env, SDD_PROJECT_ROOT: root } });

  if (dash.status !== 0) throw new Error(`fixture: dashboard falló\n${dash.stderr}`);

  // The generator logs a human line before the JSON payload.
  const jsonLine = dash.stdout.trim().split('\n').filter(Boolean).pop();

  return {
    root,
    contracts: Object.keys(CONTRACTS).length,
    edgeCases: observed,
    dashboard: JSON.parse(jsonLine).path
  };
}

module.exports = { buildFixtureProject, EDGE_CASES, CONTRACTS };

if (require.main === module) {
  const target = process.argv[2];
  const summary = buildFixtureProject(target);
  console.log(JSON.stringify(summary, null, 2));
}

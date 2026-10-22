/**
 * End-to-End Test for SDD-GL Model Context Protocol (MCP) Server
 * Simulates an MCP Client (like Cursor, Windsurf, or Claude Desktop) communicating over stdio.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const SERVER_PATH = path.join(__dirname, '..', 'mcp', 'server.js');
const REPO_ROOT = path.join(__dirname, '..');

function runMcpTest() {
  console.log('🔌 [MCP Client] Iniciando conexión con el servidor SDD-GL MCP...');

  // Tests must never touch the real repository (BR-003): the server is pointed
  // to a unique temp directory via the SDD_PROJECT_ROOT environment variable.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gl-e2e-'));
  const cleanupTmpRoot = () => fs.rmSync(tmpRoot, { recursive: true, force: true });

  const server = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: REPO_ROOT,
    env: { ...process.env, SDD_PROJECT_ROOT: tmpRoot }
  });

  let messageId = 1;
  const pendingRequests = new Map();

  // Lee respuestas JSON-RPC desde stdout del servidor
  let buffer = '';
  server.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Guarda remanente

    for (const line of lines) {
      if (!line.trim()) continue;
      const response = JSON.parse(line);
      const resolve = pendingRequests.get(response.id);
      if (resolve) {
        pendingRequests.delete(response.id);
        resolve(response);
      }
    }
  });

  function sendRequest(method, params = {}) {
    const id = messageId++;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, resolve);
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      server.stdin.write(payload);
    });
  }

  async function executeFullLifecycle() {
    try {
      // 1. Initialize
      console.log('\n1️⃣ Enviando handshake initialize...');
      const initRes = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        // FEAT-0008: declared client identity used for local usage attribution.
        clientInfo: { name: 'demo-e2e-client', version: '9.9.9' }
      });
      console.log('   ✅ Inicializado:', initRes.result.serverInfo);
      assert.strictEqual(initRes.result.serverInfo.name, 'sdd-gl-mcp-server');

      // 2. Tools List
      console.log('\n2️⃣ Solicitando lista de herramientas (tools/list)...');
      const listRes = await sendRequest('tools/list');
      const toolNames = listRes.result.tools.map(t => t.name);
      console.log('   ✅ Herramientas detectadas (' + toolNames.length + '):', toolNames.join(', '));
      assert.ok(toolNames.includes('sdd_create_contract'));
      assert.ok(toolNames.includes('sdd_validate_gate'));
      assert.ok(toolNames.includes('sdd_step_loop'));
      assert.ok(toolNames.includes('sdd_get_metrics'));
      assert.ok(toolNames.includes('sdd_audit_traceability'));

      // 3. Create Contract (empty tmp root -> next correlational ID: FEAT-0001)
      console.log('\n3️⃣ Invocando herramienta: sdd_create_contract...');
      const createRes = await sendRequest('tools/call', {
        name: 'sdd_create_contract',
        arguments: {
          title: 'Autenticación 2FA con códigos TOTP',
          type: 'FEAT',
          gate_mode: 'STRICT',
          intent: 'Habilitar autenticación de doble factor mediante códigos QR y tokens TOTP de 6 dígitos.'
        }
      });
      const createData = JSON.parse(createRes.result.content[0].text);
      console.log('   ✅ Contrato creado:', createData);
      assert.strictEqual(createData.success, true);
      const contractId = createData.contract_id;

      // Isolation assertions: the contract must live inside tmpRoot (AF-03)
      // and never inside the real repository (BR-003).
      const resolvedContractPath = path.resolve(createData.path);
      assert.ok(
        resolvedContractPath.startsWith(path.resolve(tmpRoot) + path.sep),
        `Contract path must be inside tmpRoot (${tmpRoot}): ${createData.path}`
      );
      assert.ok(
        !resolvedContractPath.startsWith(path.resolve(REPO_ROOT) + path.sep),
        `Contract path must NOT be inside the real repo (${REPO_ROOT}): ${createData.path}`
      );

      // 4. Validate Gate
      console.log(`\n4️⃣ Invocando herramienta: sdd_validate_gate (${contractId})...`);
      const validateRes = await sendRequest('tools/call', {
        name: 'sdd_validate_gate',
        arguments: { contract_id: contractId }
      });
      const validateData = JSON.parse(validateRes.result.content[0].text);
      console.log('   ✅ Validación Gate:', validateData);
      assert.strictEqual(validateData.is_draft, true);

      // 5. Get Metrics
      console.log('\n5️⃣ Invocando herramienta: sdd_get_metrics...');
      const metricsRes = await sendRequest('tools/call', {
        name: 'sdd_get_metrics',
        arguments: {}
      });
      const metricsData = JSON.parse(metricsRes.result.content[0].text);
      console.log('   ✅ Métricas obtenidas:', metricsData);
      // FEAT-0016: the ledger schema is explicit (zeros when no data), never fabricated numbers.
      assert.strictEqual(metricsData.schema_version, 1);
      assert.ok(metricsData.first_pass_quality_rate !== undefined);
      assert.ok(metricsData.counters && metricsData.counters.steps_total !== undefined);
      assert.strictEqual(metricsData.source, 'defaults');

      // 6. Audit Traceability
      console.log('\n6️⃣ Invocando herramienta: sdd_audit_traceability...');
      const auditRes = await sendRequest('tools/call', {
        name: 'sdd_audit_traceability',
        arguments: {}
      });
      const auditData = JSON.parse(auditRes.result.content[0].text);
      console.log('   ✅ Reporte de trazabilidad:', auditData);
      assert.ok(['PASSED', 'GAPS_FOUND'].includes(auditData.status));
      assert.ok(Array.isArray(auditData.orphan_specs));
      assert.strictEqual(typeof auditData.specification_coverage_score, 'number');

      // 7. Get Status Dashboard
      console.log('\n7️⃣ Invocando herramienta: sdd_get_status...');
      const statusRes = await sendRequest('tools/call', {
        name: 'sdd_get_status',
        arguments: {}
      });
      const statusData = JSON.parse(statusRes.result.content[0].text);
      console.log('   ✅ Dashboard de contratos:', statusData);
      assert.ok(statusData.total_contracts >= 1);

      // 8. Local usage telemetry (FEAT-0008): the ledger must reflect this session.
      console.log('\n8️⃣ Verificando telemetría local de uso (.sdd/usage.json)...');
      const usagePath = path.join(tmpRoot, '.sdd', 'usage.json');
      assert.ok(fs.existsSync(usagePath), 'usage.json must be created by real usage');
      const usage = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
      console.log('   ✅ Uso registrado:', usage.totals, usage.clients);

      assert.strictEqual(usage.schema_version, 1);
      assert.strictEqual(usage.sessions, 1, 'one initialize = one session');
      assert.ok(usage.clients['demo-e2e-client@9.9.9'] === 1, 'declared client must be attributed');
      assert.ok(usage.totals.calls >= 5, 'every tool call must be counted');
      assert.ok(usage.tools.sdd_get_status >= 1 && usage.tools.sdd_audit_traceability >= 1);
      assert.ok(!JSON.stringify(usage).includes(tmpRoot), 'no local paths in the ledger');

      console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL SERVIDOR MCP PASARON SATISFACTORIAMENTE AL 100%!');
      server.kill();
      cleanupTmpRoot();
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Error durante la prueba MCP:', err);
      server.kill();
      cleanupTmpRoot();
      process.exit(1);
    }
  }

  executeFullLifecycle();
}

runMcpTest();

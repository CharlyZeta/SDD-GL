/**
 * End-to-End Test for SDD-GL Model Context Protocol (MCP) Server
 * Simulates an MCP Client (like Cursor, Windsurf, or Claude Desktop) communicating over stdio.
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const SERVER_PATH = path.join(__dirname, '..', 'mcp', 'server.js');

function runMcpTest() {
  console.log('🔌 [MCP Client] Iniciando conexión con el servidor SDD-GL MCP...');
  
  const server = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: path.join(__dirname, '..')
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
      const initRes = await sendRequest('initialize');
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

      // 3. Create Contract (FEAT-0005)
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
      assert.ok(metricsData.first_pass_rate_feat !== undefined);

      // 6. Audit Traceability
      console.log('\n6️⃣ Invocando herramienta: sdd_audit_traceability...');
      const auditRes = await sendRequest('tools/call', {
        name: 'sdd_audit_traceability',
        arguments: {}
      });
      const auditData = JSON.parse(auditRes.result.content[0].text);
      console.log('   ✅ Reporte de trazabilidad:', auditData);
      assert.strictEqual(auditData.status, 'PASSED');

      // 7. Get Status Dashboard
      console.log('\n7️⃣ Invocando herramienta: sdd_get_status...');
      const statusRes = await sendRequest('tools/call', {
        name: 'sdd_get_status',
        arguments: {}
      });
      const statusData = JSON.parse(statusRes.result.content[0].text);
      console.log('   ✅ Dashboard de contratos:', statusData);
      assert.ok(statusData.total_contracts >= 1);

      console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL SERVIDOR MCP PASARON SATISFACTORIAMENTE AL 100%!');
      server.kill();
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Error durante la prueba MCP:', err);
      server.kill();
      process.exit(1);
    }
  }

  executeFullLifecycle();
}

runMcpTest();

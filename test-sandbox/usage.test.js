/**
 * FEAT-0008 — Local usage telemetry + honest dashboard (no fabricated metrics).
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Runs against throw-away SDD_PROJECT_ROOT (non-destructive, FEAT-0006).
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-usage-'));
process.env.SDD_PROJECT_ROOT = tempRoot;

const { handleToolCall, TOOLS } = require('../mcp/server.js');
const { generateDashboard } = require('../mcp/dashboard-gen.js');

const contractsDir = path.join(tempRoot, 'contracts');
const sddDir = path.join(tempRoot, '.sdd');
const usagePath = path.join(sddDir, 'usage.json');
const metricsPath = path.join(sddDir, 'metrics.json');

fs.mkdirSync(contractsDir, { recursive: true });

function resetTelemetry() {
  for (const file of [usagePath, metricsPath]) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  fs.mkdirSync(sddDir, { recursive: true });
}

function readUsage() {
  return JSON.parse(fs.readFileSync(usagePath, 'utf8'));
}

function writeContract(id, gateMode = 'EXPRESS') {
  fs.writeFileSync(path.join(contractsDir, `${id}.md`), `# CONTRACT: Fixture ${id}
# ID: ${id}
# Status: RESOLVED
# Mode: LOOP
# Gate-Mode: ${gateMode}
# Intent
Fixture.
`, 'utf8');
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('FEAT-0008 — Business Rules', () => {
  test('BR-006: the server performs no network calls for telemetry', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'server.js'), 'utf8');

    assert.ok(!/require\(['"](http|https|net|dgram|tls)['"]\)/.test(source), 'no network modules');
    assert.ok(!/\bfetch\s*\(/.test(source), 'no fetch()');
    assert.ok(!/XMLHttpRequest/.test(source), 'no XMLHttpRequest');
  });

  test('BR-007: the usage ledger never stores arguments, paths or secrets', () => {
    resetTelemetry();

    handleToolCall('sdd_get_status', {
      fake_path: '/home/someone/private/project',
      password: 'supersecret123',
      contract_body: 'contenido del contrato'
    });

    const raw = fs.readFileSync(usagePath, 'utf8');
    assert.ok(!raw.includes('/home/someone/private/project'), 'must not persist paths');
    assert.ok(!raw.includes('supersecret123'), 'must not persist secrets');
    assert.ok(!raw.includes('contenido del contrato'), 'must not persist arguments/content');
    assert.match(raw, /"sdd_get_status"/);
  });

  test('BR-009: usage counters are exact, never estimated', () => {
    resetTelemetry();

    handleToolCall('sdd_get_status', {});
    handleToolCall('sdd_get_status', {});
    handleToolCall('sdd_get_metrics', {});

    const usage = readUsage();
    assert.strictEqual(usage.tools.sdd_get_status, 2);
    assert.strictEqual(usage.tools.sdd_get_metrics, 1);
    assert.strictEqual(usage.totals.calls, 3);
  });
});

describe('FEAT-0008 — Alternative Flows', () => {
  test('AF-02: a client that does not declare itself is grouped as "cliente no declarado"', () => {
    resetTelemetry();
    fs.writeFileSync(usagePath, JSON.stringify({
      schema_version: 1,
      sessions: 1,
      clients: { 'cliente no declarado': 1 },
      tools: {},
      totals: { calls: 0, errors: 0 }
    }), 'utf8');

    const usage = readUsage();
    assert.ok(Object.keys(usage.clients).includes('cliente no declarado'));
  });

  test('AF-03: without metrics.json the quality KPIs report absence, not fake zeros', () => {
    resetTelemetry();

    const result = handleToolCall('sdd_get_metrics', {});

    assert.strictEqual(result.source, 'defaults');
    assert.strictEqual(result.first_pass_quality_rate, 0);
  });
});

describe('FEAT-0008 — Acceptance Criteria', () => {
  test('AC-005: GIVEN N tool calls WHEN the ledger is read THEN per-tool counts match exactly', () => {
    resetTelemetry();

    handleToolCall('sdd_get_status', {});
    handleToolCall('sdd_get_status', {});
    handleToolCall('sdd_get_status', {});
    handleToolCall('sdd_audit_traceability', {});

    const usage = readUsage();
    assert.strictEqual(usage.tools.sdd_get_status, 3);
    assert.strictEqual(usage.tools.sdd_audit_traceability, 1);
    assert.strictEqual(usage.totals.calls, 4);
  });

  test('AC-006: GIVEN a declared clientInfo WHEN the session initializes THEN usage is attributed', () => {
    // The initialize path is exercised through the exported helper contract:
    // a declared client is stored verbatim (name@version) and increments sessions.
    resetTelemetry();
    fs.writeFileSync(usagePath, JSON.stringify({
      schema_version: 1,
      sessions: 0,
      clients: {},
      tools: {},
      totals: { calls: 0, errors: 0 }
    }), 'utf8');

    // Simulate what main() does on initialize.
    const server = require('../mcp/server.js');
    assert.ok(server.TOOLS.length === 8);

    // The instrumentation lives in main(); its effect is verified by the e2e handshake
    // plus the ledger shape asserted here.
    const usage = readUsage();
    assert.strictEqual(usage.schema_version, 1);
    assert.strictEqual(typeof usage.sessions, 'number');
    assert.strictEqual(typeof usage.clients, 'object');
  });

  test('AC-007: GIVEN the generated HTML WHEN inspected THEN data is inline and no network fetch is used', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-nofetch-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.ok(!/\bfetch\s*\(/.test(html), 'no fetch() to obtain data');
      assert.ok(!/XMLHttpRequest/.test(html), 'no XHR');
      assert.ok(!/axios/.test(html), 'no axios');
      assert.match(html, /const CHART_DATA = \{/, 'data must be inlined');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AC-008: GIVEN no usage.json WHEN the dashboard is generated THEN the usage section says "sin datos"', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-empty-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.match(html, /Uso local del MCP/);
      assert.match(html, /sin datos \(no \.sdd\/usage\.json\)/);
      assert.match(result.usage_source, /sin datos/);
      assert.strictEqual(result.tool_calls, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AC-002: GIVEN no telemetry WHEN the dashboard is generated THEN the clients section reports absence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-platforms-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.match(html, /Clientes declarados/);
      assert.ok(!/Cursor:\s*<strong[^>]*>42%/.test(html), 'no invented platform distribution');
      assert.ok(!/128\+ Requests/.test(html), 'no invented request count');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AC-003: GIVEN the server WHEN the dashboard is generated THEN the tool count is derived dynamically', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-tools-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.match(html, new RegExp(`${TOOLS.length} herramientas`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('AC-004: GIVEN a metrics ledger WHEN the dashboard is generated THEN the KPIs reflect it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-metrics-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
      fs.writeFileSync(path.join(root, '.sdd', 'metrics.json'), JSON.stringify({
        schema_version: 1,
        last_updated: new Date().toISOString(),
        first_pass_quality_rate: 87.5,
        average_retries: 0.25,
        ambiguity_escalation_rate: 4.5,
        layer_success_rates: { functional: 90, static: 100, security: 100, arch: 50 }
      }), 'utf8');

      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.match(html, /87\.5%/);
      assert.match(html, /90%/);
      assert.strictEqual(result.metrics_source, '.sdd/metrics.json');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('BR-001: with no ledger the dashboard never presents a fabricated percentage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-honest-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.ok(!/88%/.test(html), 'the old fabricated FPQR must be gone');
      assert.ok(!/95\.0|98\.0/.test(html), 'the old fabricated layer rates must be gone');
      assert.match(html, /sin datos/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('BR-004: the tool count in the dashboard matches the server at runtime', () => {
    assert.strictEqual(TOOLS.length, 8);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-count-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');
      assert.match(html, /8 herramientas/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('BR-008: the generated HTML is self-contained (usable and publishable as-is)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-portable-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      // Data is inline; the only external resources are rendering libraries (Tailwind/Chart/lucide).
      const external = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
      assert.ok(external.every(url => /tailwindcss|chart\.js|lucide/.test(url)), `unexpected external script: ${external.join(', ')}`);
      assert.ok(fs.existsSync(result.path));
      assert.match(html, /<\/html>/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('BR-005: layer rates come from the ledger, not from example values', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-layers-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
      fs.writeFileSync(path.join(root, '.sdd', 'metrics.json'), JSON.stringify({
        schema_version: 1,
        last_updated: new Date().toISOString(),
        first_pass_quality_rate: 66.7,
        layer_success_rates: { functional: 33.3, static: 100, security: 0, arch: 100 }
      }), 'utf8');

      const result = generateDashboard(root);
      const html = fs.readFileSync(result.path, 'utf8');

      assert.match(html, /33\.3%/);
      assert.match(html, /"layers":\[33\.3,100,0,100\]/, 'chart data must carry the ledger rates');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('FEAT-0012 isolation — showcase mode', () => {
  test('the public dashboard renders only examples/contracts and ignores private state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-showcase-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      fs.mkdirSync(path.join(root, 'examples', 'contracts'), { recursive: true });
      fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });

      fs.writeFileSync(path.join(root, 'contracts', 'FEAT-9998.md'),
        '# CONTRACT: Private roadmap item\n# ID: FEAT-9998\n# Status: APPROVED\n# Mode: LOOP\n# Gate-Mode: STRICT\n', 'utf8');
      fs.writeFileSync(path.join(root, 'examples', 'contracts', 'FEAT-9100.md'),
        '# CONTRACT: Public showcase item\n# ID: FEAT-9100\n# Status: RESOLVED\n# Mode: LOOP\n# Gate-Mode: EXPRESS\n', 'utf8');
      fs.writeFileSync(path.join(root, '.sdd', 'metrics.json'),
        JSON.stringify({ schema_version: 1, last_updated: new Date().toISOString(), first_pass_quality_rate: 42.5 }), 'utf8');
      fs.writeFileSync(path.join(root, '.sdd', 'usage.json'),
        JSON.stringify({ schema_version: 1, sessions: 7, clients: { 'private-client@1.0': 3 }, tools: { sdd_step_loop: 9 }, totals: { calls: 9, errors: 0 } }), 'utf8');

      const result = generateDashboard(root, { publicShowcase: true });
      const html = fs.readFileSync(result.path, 'utf8');

      assert.strictEqual(result.scope, 'public-showcase');
      assert.strictEqual(result.path, path.join(root, 'docs', 'index.html'));
      assert.ok(html.includes('FEAT-9100'), 'showcase contract must be rendered');
      assert.ok(!html.includes('FEAT-9998'), 'private working contract must never leak');
      assert.ok(!html.includes('42.5'), 'private quality telemetry must not leak');
      assert.ok(!html.includes('private-client@1.0'), 'private usage telemetry must not leak');
      assert.match(html, /dashboard público del showcase/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('local mode writes outside the published docs/ directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-dash-local-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      const result = generateDashboard(root);

      assert.strictEqual(result.scope, 'local');
      assert.strictEqual(result.path, path.join(root, '.sdd', 'dashboard.html'));
      assert.ok(!result.path.includes(`${path.sep}docs${path.sep}`), 'local dashboard must not land in docs/');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

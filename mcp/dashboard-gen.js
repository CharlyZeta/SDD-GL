#!/usr/bin/env node

/**
 * SDD-GL Living Visual Dashboard Generator
 * Compiles contracts, metrics, layer telemetry, and test results into a standalone HTML dashboard.
 */

const fs = require('fs');
const path = require('path');

function getProjectRoot(customRoot) {
  if (customRoot) return customRoot;
  if (process.env.SDD_PROJECT_ROOT) return process.env.SDD_PROJECT_ROOT;
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'contracts')) || fs.existsSync(path.join(cwd, '.sdd'))) {
    return cwd;
  }
  return path.resolve(__dirname, '..');
}

function generateDashboard(customRoot) {
  const PROJECT_ROOT = getProjectRoot(customRoot);
  const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'contracts');
  const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
  const METRICS_FILE = path.join(PROJECT_ROOT, '.sdd', 'metrics.json');
  const RUNS_DIR = path.join(PROJECT_ROOT, '.sdd', 'runs');

  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }

  // 1. Gather all contracts
  let contracts = [];
  if (fs.existsSync(CONTRACTS_DIR)) {
    const files = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.md'));
    contracts = files.map(file => {
      const content = fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8');
      const titleMatch = content.match(/# CONTRACT:\s*(.+)/);
      const idMatch = content.match(/# ID:\s*(.+)/);
      const statusMatch = content.match(/# Status:\s*(DRAFT|APPROVED|RESOLVED)/);
      const modeMatch = content.match(/# Mode:\s*(GATE|LOOP)/);
      const gateModeMatch = content.match(/# Gate-Mode:\s*(EXPRESS|STRICT)/);
      const intentMatch = content.match(/## Intent\s*([\s\S]*?)(?=## Use Case|$)/);

      // Extract BRs and ACs
      const brMatches = content.match(/BR-\d+/g) || [];
      const uniqueBRs = [...new Set(brMatches)];
      const acMatches = content.match(/AC-\d+/g) || [];
      const uniqueACs = [...new Set(acMatches)];

      // Extract Completion Map items
      const mapMatches = content.match(/^#\s*([^|\n]+)\|\s*([^|\n]+)\|\s*([^|\n]+)\|\s*([^|\n]+)\|\s*(✅|⏳|❌)/gm) || [];
      const mapItems = mapMatches.map(line => {
        const parts = line.replace(/^#\s*/, '').split('|').map(s => s.trim());
        return {
          item: parts[0],
          layer: parts[1],
          testId: parts[2],
          agent: parts[3],
          status: parts[4]
        };
      });

      const totalItems = mapItems.length;
      const passedItems = mapItems.filter(i => i.status === '✅').length;
      const progressPct = totalItems > 0 ? Math.round((passedItems / totalItems) * 100) : (statusMatch && statusMatch[1] === 'RESOLVED' ? 100 : 0);

      return {
        id: idMatch ? idMatch[1].trim() : file.replace('.md', ''),
        title: titleMatch ? titleMatch[1].trim() : 'Sin Título',
        status: statusMatch ? statusMatch[1].trim() : 'DRAFT',
        mode: modeMatch ? modeMatch[1].trim() : 'GATE',
        gateMode: gateModeMatch ? gateModeMatch[1].trim() : 'STRICT',
        intent: intentMatch ? intentMatch[1].trim().replace(/\n/g, ' ') : '',
        brCount: uniqueBRs.length,
        acCount: uniqueACs.length,
        totalItems,
        passedItems,
        progressPct,
        mapItems
      };
    });
  }

  // 2. Quality metrics — only values that exist on disk (FEAT-0008: no fabricated numbers).
  let metrics = {
    first_pass_quality_rate: null,
    average_retries: null,
    ambiguity_escalation_rate: null,
    layer_success_rates: { functional: null, static: null, security: null, arch: null },
    last_updated: null
  };

  // 2b. Local usage telemetry (FEAT-0008). 100% local: no network, no global aggregation.
  const USAGE_FILE = path.join(PROJECT_ROOT, '.sdd', 'usage.json');
  let usage = {
    totals: { calls: 0, errors: 0 },
    tools: {},
    clients: {},
    sessions: 0,
    first_seen: null,
    last_updated: null
  };
  let usageSource = 'sin datos (no .sdd/usage.json)';

  if (fs.existsSync(USAGE_FILE)) {
    try {
      const parsedUsage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
      if (parsedUsage && parsedUsage.schema_version === 1) {
        usage = {
          totals: { calls: 0, errors: 0, ...(parsedUsage.totals || {}) },
          tools: { ...(parsedUsage.tools || {}) },
          clients: { ...(parsedUsage.clients || {}) },
          sessions: parsedUsage.sessions || 0,
          first_seen: parsedUsage.first_seen || null,
          last_updated: parsedUsage.last_updated || null
        };
        usageSource = '.sdd/usage.json';
      } else {
        usageSource = 'sin datos (usage.json con esquema distinto)';
      }
    } catch (error) {
      usageSource = `sin datos (usage.json ilegible: ${error.message})`;
    }
  }

  const hasUsage = usageSource === '.sdd/usage.json' && usage.totals.calls > 0;

  // FEAT-0016: `.sdd/metrics.json` is the single source of truth for quality metrics.
  let metricsSource = 'sin datos (no .sdd/metrics.json)';
  if (fs.existsSync(METRICS_FILE)) {
    try {
      const ledger = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
      if (ledger && ledger.schema_version === 1) {
        metricsSource = '.sdd/metrics.json';
        metrics.first_pass_quality_rate = ledger.first_pass_quality_rate;
        metrics.average_retries = ledger.average_retries;
        metrics.ambiguity_escalation_rate = ledger.ambiguity_escalation_rate;
        metrics.layer_success_rates = ledger.layer_success_rates || metrics.layer_success_rates;
        metrics.last_updated = ledger.last_updated;
      } else {
        metricsSource = 'sin datos (ledger con esquema distinto)';
      }
    } catch (error) {
      metricsSource = `sin datos (ledger ilegible: ${error.message})`;
    }
  }

  // With no recorded telemetry the panel must say "sin datos" instead of 0% (no invented numbers).
  const metricsHasData = metricsSource === '.sdd/metrics.json' && Boolean(metrics.last_updated);

  const resolvedCount = contracts.filter(c => c.status === 'RESOLVED').length;
  const inProgressCount = contracts.filter(c => c.status === 'APPROVED').length;
  const draftCount = contracts.filter(c => c.status === 'DRAFT').length;

  // Derived from real on-disk contracts (not constants).
  const featCount = contracts.filter(c => c.id.startsWith('FEAT')).length;
  const fixCount = contracts.filter(c => c.id.startsWith('FIX')).length;
  const strictCount = contracts.filter(c => c.gateMode === 'STRICT').length;
  const expressCount = contracts.filter(c => c.gateMode === 'EXPRESS').length;
  const share = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

  let toolCount = null;
  try {
    toolCount = require('./server.js').TOOLS.length;
  } catch (error) {
    toolCount = null; // reported as "sin datos" below instead of a hardcoded number
  }

  const toolEntries = Object.entries(usage.tools).sort((a, b) => b[1] - a[1]);
  const clientEntries = Object.entries(usage.clients).sort((a, b) => b[1] - a[1]);
  const layerEntries = Object.entries(metrics.layer_success_rates);
  const formatRate = value => (value === null || value === undefined ? '—' : `${value}%`);

  // Chart payloads are built from on-disk data only; empty arrays render as "sin datos".
  const chartData = {
    layers: layerEntries.map(([, value]) => (value === null || value === undefined ? 0 : value)),
    toolLabels: toolEntries.map(([name]) => name),
    toolValues: toolEntries.map(([, count]) => count),
    clientLabels: clientEntries.map(([name]) => name),
    clientValues: clientEntries.map(([, count]) => count),
    contractsByStatus: [resolvedCount, inProgressCount, draftCount]
  };

  const lastUpdated = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  // 3. Build HTML Output
  const htmlContent = `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SDD-GL — Living Visual Dashboard & Telemetry</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            sddDark: '#0B0F17',
            sddCard: '#111827',
            sddBorder: '#1F2937',
            sddCyan: '#06B6D4',
            sddEmerald: '#10B981',
            sddAmber: '#F59E0B',
            sddPurple: '#8B5CF6'
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #0B0F17; color: #F3F4F6; font-family: system-ui, -apple-system, sans-serif; }
    .glass-card { background: rgba(17, 24, 39, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); }
    .glass-card:hover { border-color: rgba(6, 182, 212, 0.4); }
    .neon-text-cyan { text-shadow: 0 0 12px rgba(6, 182, 212, 0.5); }
    .neon-text-emerald { text-shadow: 0 0 12px rgba(16, 185, 129, 0.5); }
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
  </style>
</head>
<body class="min-h-screen flex flex-col custom-scrollbar">

  <!-- TOP NAVIGATION HEADER -->
  <header class="border-b border-sddBorder/80 bg-sddDark/80 backdrop-blur sticky top-0 z-50 px-6 py-4">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-sddCyan to-sddEmerald flex items-center justify-center font-black text-black text-xl shadow-lg shadow-sddCyan/20">
          ⚡
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            SDD-GL <span class="text-xs px-2 py-0.5 rounded-full bg-sddCyan/10 text-sddCyan border border-sddCyan/30 font-mono">v0.4.0 Live</span>
          </h1>
          <p class="text-xs text-gray-400">Spec-Driven Development · Gate / Loop & AC/DC Telemetry</p>
        </div>
      </div>

      <div class="flex items-center space-x-4">
        <div class="flex items-center text-xs text-gray-400 bg-sddCard/80 px-3 py-1.5 rounded-md border border-sddBorder">
          <span class="w-2 h-2 rounded-full bg-sddEmerald animate-pulse mr-2"></span>
          Última actualización: <span class="text-gray-200 font-mono ml-1.5">${lastUpdated}</span>
        </div>
        <a href="https://github.com/CharlyZeta/SDD-GL" target="_blank" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs text-white rounded-md transition font-medium border border-gray-700">
          <i data-lucide="github" class="w-4 h-4"></i> GitHub
        </a>
      </div>
    </div>
  </header>

  <!-- MAIN CONTENT CONTAINER -->
  <main class="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-8">

    <!-- HERO KPI STAT CARDS -->
    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      <!-- KPI 1 -->
      <div class="glass-card p-5 rounded-xl">
        <div class="flex items-center justify-between text-gray-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">First-Pass Quality (FPQR)</span>
          <i data-lucide="target" class="w-5 h-5 text-sddCyan"></i>
        </div>
        <div class="text-3xl font-extrabold text-white neon-text-cyan">${metricsHasData ? `${metrics.first_pass_quality_rate}%` : 'sin datos'}</div>
        <p class="text-xs text-gray-400 mt-2 flex items-center">
          <span class="text-sddEmerald font-medium mr-1">Fuente:</span> ${metricsSource}
        </p>
      </div>

      <!-- KPI 2 -->
      <div class="glass-card p-5 rounded-xl">
        <div class="flex items-center justify-between text-gray-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Pruebas en las 4 Capas</span>
          <i data-lucide="shield-check" class="w-5 h-5 text-sddEmerald"></i>
        </div>
        <div class="text-3xl font-extrabold text-white neon-text-emerald">${metricsHasData ? layerEntries.map(([, value]) => formatRate(value)).join(' · ') : 'sin datos'}</div>
        <p class="text-xs text-gray-400 mt-2">
          ${metricsHasData ? 'Funcional · Estático · Seguridad · Arquitectura' : 'El ledger de calidad todavía no registró pasos.'}
        </p>
      </div>

      <!-- KPI 3 -->
      <div class="glass-card p-5 rounded-xl">
        <div class="flex items-center justify-between text-gray-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Tasa de Autorreparación (Solve)</span>
          <i data-lucide="wrench" class="w-5 h-5 text-sddAmber"></i>
        </div>
        <div class="text-3xl font-extrabold text-white">${metricsHasData ? metrics.average_retries : 'sin datos'}</div>
        <p class="text-xs text-gray-400 mt-2">
          Promedio de reintentos por contract${metricsHasData ? '' : ' (sin telemetría registrada)'}
        </p>
      </div>

      <!-- KPI 4 -->
      <div class="glass-card p-5 rounded-xl">
        <div class="flex items-center justify-between text-gray-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Contratos Registrados</span>
          <i data-lucide="file-text" class="w-5 h-5 text-sddPurple"></i>
        </div>
        <div class="text-3xl font-extrabold text-white">${contracts.length}</div>
        <p class="text-xs text-gray-400 mt-2">
          <span class="text-sddEmerald font-semibold">${resolvedCount} Resueltos</span> · ${inProgressCount} Loop · ${draftCount} Gate
        </p>
      </div>
    </section>

    <!-- INTERACTIVE CHARTS & LAYER MATRIX -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- CHART: LAYER VERIFICATION PASS RATES -->
      <div class="glass-card p-6 rounded-xl flex flex-col">
        <h3 class="text-sm font-semibold uppercase text-gray-300 mb-4 flex items-center gap-2">
          <i data-lucide="layers" class="w-4 h-4 text-sddCyan"></i> Matriz AC/DC de 4 Capas
        </h3>
        <div class="flex-1 flex items-center justify-center min-h-[200px]">
          <canvas id="layersChart"></canvas>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-4 text-xs text-gray-400 pt-3 border-t border-sddBorder">
          <div>🧪 Funcional: <span class="text-white font-mono font-bold">${formatRate(metrics.layer_success_rates.functional)}</span></div>
          <div>🔍 Estático/Tipos: <span class="text-white font-mono font-bold">${formatRate(metrics.layer_success_rates.static)}</span></div>
          <div>🛡️ Seguridad SAST: <span class="text-white font-mono font-bold">${formatRate(metrics.layer_success_rates.security)}</span></div>
          <div>🏛️ Arquitectura: <span class="text-white font-mono font-bold">${formatRate(metrics.layer_success_rates.arch)}</span></div>
        </div>
      </div>

      <!-- CHART: LOCAL USAGE BY TOOL -->
      <div class="glass-card p-6 rounded-xl flex flex-col">
        <h3 class="text-sm font-semibold uppercase text-gray-300 mb-4 flex items-center gap-2">
          <i data-lucide="trending-up" class="w-4 h-4 text-sddEmerald"></i> Uso local: invocaciones por herramienta
        </h3>
        <div class="flex-1 flex items-center justify-center min-h-[200px]">
          ${hasUsage ? '<canvas id="evolutionChart"></canvas>' : '<p class="text-xs text-gray-500 text-center">sin datos</p>'}
        </div>
        <div class="text-xs text-gray-400 mt-4 pt-3 border-t border-sddBorder text-center">
          ${hasUsage ? `${usage.totals.calls} invocaciones · ${usage.sessions} sesiones · fuente ${usageSource}` : usageSource}
        </div>
      </div>

      <!-- STATE MACHINE & MCP INTERCONNECTIVITY -->
      <div class="glass-card p-6 rounded-xl flex flex-col justify-between">
        <div>
          <h3 class="text-sm font-semibold uppercase text-gray-300 mb-3 flex items-center gap-2">
            <i data-lucide="cpu" class="w-4 h-4 text-sddAmber"></i> Ecosistema Universal MCP
          </h3>
          <p class="text-xs text-gray-400 mb-4">
            El servidor JSON-RPC stdio expone ${toolCount === null ? 'un número no disponible (sin datos)' : `${toolCount} herramientas`} universales, consumidas por cualquier cliente MCP.
          </p>
          <div class="space-y-2 text-xs font-mono">
            <div class="flex items-center justify-between p-2 rounded bg-black/40 border border-sddBorder">
              <span class="text-sddCyan">sdd_create_contract</span>
              <span class="text-gray-400 text-[10px]">Gate Inception</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded bg-black/40 border border-sddBorder">
              <span class="text-sddCyan">sdd_validate_gate</span>
              <span class="text-gray-400 text-[10px]">Consistency Check</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded bg-black/40 border border-sddBorder">
              <span class="text-sddEmerald">sdd_step_loop</span>
              <span class="text-gray-400 text-[10px]">AC/DC Execution</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded bg-black/40 border border-sddBorder">
              <span class="text-sddAmber">sdd_log_ambiguity</span>
              <span class="text-gray-400 text-[10px]">Human Escalation</span>
            </div>
            <div class="flex items-center justify-between p-2 rounded bg-black/40 border border-sddBorder">
              <span class="text-sddPurple">sdd_get_metrics</span>
              <span class="text-gray-400 text-[10px]">Live Telemetry</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- TEMPORAL ROADMAP: PAST, PRESENT & FUTURE -->
    <section class="glass-card p-6 rounded-xl space-y-6">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <i data-lucide="clock" class="w-5 h-5 text-sddCyan"></i> Línea de Vida del Framework: Pasado, Presente y Futuro
        </h3>
        <span class="text-xs px-2.5 py-1 rounded bg-sddCard border border-sddBorder text-gray-300">Hoja de Ruta Interactiva</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        <!-- PAST -->
        <div class="p-4 rounded-lg bg-black/30 border border-sddBorder space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Pasado (v0.1 → v0.3)</span>
            <span class="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">Entregado</span>
          </div>
          <ul class="text-xs text-gray-300 space-y-2">
            <li class="flex items-start gap-1.5">
              <span class="text-sddEmerald font-bold">✓</span> Máquina de estados Gate/Loop y Completion Map.
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddEmerald font-bold">✓</span> Soporte nativo para Google Antigravity CLI e IDE.
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddEmerald font-bold">✓</span> Gobernanza Adaptativa (GATE-EXPRESS vs STRICT).
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddEmerald font-bold">✓</span> Presets para Spring Boot, FastAPI y TypeScript.
            </li>
          </ul>
        </div>

        <!-- PRESENT -->
        <div class="p-4 rounded-lg bg-sddCyan/5 border border-sddCyan/30 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-sddCyan uppercase tracking-wider">Presente (v0.4.0 Actual)</span>
            <span class="text-xs px-2 py-0.5 rounded bg-sddCyan/20 text-sddCyan font-semibold">En Producción</span>
          </div>
          <ul class="text-xs text-gray-200 space-y-2">
            <li class="flex items-start gap-1.5">
              <span class="text-sddCyan font-bold">⚡</span> Verificación en 4 Capas (Capa AC/DC).
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddCyan font-bold">⚡</span> Agente Solve de autorreparación (≤ 3 reintentos).
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddCyan font-bold">⚡</span> Servidor MCP ejecutable estándar en Node.js.
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddCyan font-bold">⚡</span> Living Visual Dashboard en GitHub Pages.
            </li>
          </ul>
        </div>

        <!-- FUTURE -->
        <div class="p-4 rounded-lg bg-sddPurple/5 border border-sddPurple/30 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-sddPurple uppercase tracking-wider">Futuro (v0.5.0 Próxima)</span>
            <span class="text-xs px-2 py-0.5 rounded bg-sddPurple/20 text-sddPurple font-semibold">Roadmap</span>
          </div>
          <ul class="text-xs text-gray-300 space-y-2">
            <li class="flex items-start gap-1.5">
              <span class="text-sddPurple font-bold">○</span> GitHub Actions CI/CD Workflow (sdd-verify-action).
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddPurple font-bold">○</span> CLI sdd-review para heatmaps de cobertura entre contratos.
            </li>
            <li class="flex items-start gap-1.5">
              <span class="text-sddPurple font-bold">○</span> Modelado de dependencias entre especificaciones (depends_on).
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- LOCAL MCP USAGE (FEAT-0008: 100% local, no global aggregation) -->
    <section class="glass-card p-6 rounded-xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <i data-lucide="activity" class="w-5 h-5 text-sddCyan"></i> Uso local del MCP (esta máquina)
          </h3>
          <p class="text-xs text-gray-400">Invocaciones reales registradas en <code>.sdd/usage.json</code>. Sin agregación global ni llamadas de red: este HTML es tuyo y podés publicarlo como métrica de uso de la metodología.</p>
        </div>
        <div class="flex items-center gap-2 text-[10px] text-gray-400 bg-black/40 px-3 py-1.5 rounded border border-sddBorder">
          <span class="w-2 h-2 rounded-full ${hasUsage ? 'bg-sddEmerald' : 'bg-gray-600'}"></span>
          <span>Fuente: ${usageSource}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <!-- CHART: DECLARED CLIENTS -->
        <div class="p-4 rounded-lg bg-black/30 border border-sddBorder flex flex-col justify-between">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-bold uppercase text-gray-300 flex items-center gap-1.5">
              <i data-lucide="bot" class="w-4 h-4 text-sddCyan"></i> Clientes declarados
            </h4>
            <span class="text-[10px] font-mono text-sddCyan">${hasUsage ? `${usage.totals.calls} llamadas` : 'sin datos'}</span>
          </div>
          <div class="min-h-[180px] flex items-center justify-center">
            ${clientEntries.length > 0 ? '<canvas id="platformsChart"></canvas>' : '<p class="text-xs text-gray-500 text-center">sin datos</p>'}
          </div>
          <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-400 pt-3 border-t border-sddBorder mt-3">
            ${clientEntries.length > 0
              ? clientEntries.map(([name, count]) => `<div>${name}: <strong class="text-white">${count}</strong></div>`).join('')
              : '<div class="col-span-2">Ningún cliente se identificó (`clientInfo` autodeclarado).</div>'}
          </div>
        </div>

        <!-- WORKLOAD RATIOS & GATE MODES -->
        <div class="p-4 rounded-lg bg-black/30 border border-sddBorder flex flex-col justify-between space-y-4">
          <h4 class="text-xs font-bold uppercase text-gray-300 flex items-center gap-1.5">
            <i data-lucide="pie-chart" class="w-4 h-4 text-sddEmerald"></i> Distribución de Carga y Modos
          </h4>
          
          <div class="space-y-3">
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-gray-400">Features vs. Fixes</span>
                <span class="font-mono text-sddCyan">${share(featCount, contracts.length)}% FEAT / ${share(fixCount, contracts.length)}% FIX</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-2 flex overflow-hidden">
                <div class="bg-sddCyan h-2" style="width: ${share(featCount, contracts.length)}%"></div>
                <div class="bg-sddAmber h-2" style="width: ${share(fixCount, contracts.length)}%"></div>
              </div>
            </div>

            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-gray-400">Modos de Gobernanza</span>
                <span class="font-mono text-sddEmerald">${share(strictCount, contracts.length)}% STRICT / ${share(expressCount, contracts.length)}% EXPRESS</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-2 flex overflow-hidden">
                <div class="bg-sddEmerald h-2" style="width: ${share(strictCount, contracts.length)}%"></div>
                <div class="bg-sddPurple h-2" style="width: ${share(expressCount, contracts.length)}%"></div>
              </div>
            </div>

            <div class="p-3 rounded bg-sddCard/60 border border-sddBorder text-xs text-gray-300 space-y-1">
              <div class="flex justify-between">
                <span class="text-gray-400">Reintentos promedio por contract:</span>
                <strong class="text-sddEmerald">${metricsHasData ? metrics.average_retries : 'sin datos'}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Escalados a Gate por Ambigüedad:</span>
                <strong class="text-sddAmber">${metricsHasData ? `${metrics.ambiguity_escalation_rate}%` : 'sin datos'}</strong>
              </div>
            </div>
          </div>

          <div class="text-[10px] text-gray-500 text-center">
            Contratos contados desde <code>contracts/</code>; calidad desde <code>.sdd/metrics.json</code>
          </div>
        </div>

        <!-- CHART: MCP TOOL TRAFFIC -->
        <div class="p-4 rounded-lg bg-black/30 border border-sddBorder flex flex-col justify-between">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-bold uppercase text-gray-300 flex items-center gap-1.5">
              <i data-lucide="bar-chart-2" class="w-4 h-4 text-sddPurple"></i> Invocaciones por Herramienta MCP
            </h4>
            <span class="text-[10px] font-mono text-sddPurple">${hasUsage ? `${usage.totals.errors} errores` : 'sin datos'}</span>
          </div>
          <div class="min-h-[180px] flex items-center justify-center">
            ${toolEntries.length > 0 ? '<canvas id="toolsChart"></canvas>' : '<p class="text-xs text-gray-500 text-center">sin datos</p>'}
          </div>
          <div class="text-[10px] text-gray-500 pt-2 border-t border-sddBorder text-center">
            ${toolEntries.length > 0 ? `Más usada: ${toolEntries[0][0]} (${toolEntries[0][1]} llamadas)` : 'Todavía no hay invocaciones registradas'}
          </div>
        </div>

      </div>
    </section>

    <!-- INTERACTIVE CONTRACT EXPLORER -->
    <section class="glass-card p-6 rounded-xl space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <i data-lucide="terminal" class="w-5 h-5 text-sddEmerald"></i> Explorador de Contratos de Especificación
          </h3>
          <p class="text-xs text-gray-400">Inspección de contratos, reglas de negocio y Completion Maps en disco</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${contracts.map(c => `
          <div class="p-4 rounded-lg bg-black/40 border border-sddBorder hover:border-sddCyan/50 transition space-y-3 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-mono font-bold ${c.id.startsWith('FEAT') ? 'text-sddCyan' : 'text-sddAmber'}">${c.id}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  c.status === 'RESOLVED' ? 'bg-sddEmerald/20 text-sddEmerald border border-sddEmerald/30' :
                  c.status === 'APPROVED' ? 'bg-sddAmber/20 text-sddAmber border border-sddAmber/30' :
                  'bg-gray-700 text-gray-300'
                }">
                  ${c.status}
                </span>
              </div>
              <h4 class="text-sm font-semibold text-white line-clamp-1">${c.title}</h4>
              <p class="text-xs text-gray-400 mt-1 line-clamp-2">${c.intent || 'Especificación formal del contrato.'}</p>
            </div>

            <div class="pt-3 border-t border-sddBorder/60 space-y-2">
              <div class="flex items-center justify-between text-xs text-gray-400">
                <span>Modo: <strong class="text-gray-200">${c.gateMode}</strong></span>
                <span>BR: <strong class="text-gray-200">${c.brCount}</strong> | AC: <strong class="text-gray-200">${c.acCount}</strong></span>
              </div>
              <div>
                <div class="flex justify-between text-[10px] text-gray-400 mb-1">
                  <span>Progreso Completion Map</span>
                  <span class="font-mono font-bold text-sddEmerald">${c.progressPct}%</span>
                </div>
                <div class="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div class="bg-gradient-to-r from-sddCyan to-sddEmerald h-1.5 rounded-full" style="width: ${c.progressPct}%"></div>
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

  </main>

  <!-- FOOTER -->
  <footer class="border-t border-sddBorder bg-sddDark/90 py-6 text-center text-xs text-gray-500">
    <div class="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <strong>SDD-GL</strong> — Spec-Driven Development: Gate / Loop Framework &copy; 2026 Gerardo Maidana. Licencia MIT.
      </div>
      <div class="flex space-x-4">
        <a href="https://github.com/CharlyZeta/SDD-GL" class="hover:text-gray-300">GitHub</a>
        <a href="https://charlyzeta.github.io/SDD-GL/" class="hover:text-gray-300">Live Dashboard</a>
      </div>
    </div>
  </footer>

  <!-- INITIALIZE ICONS & CHARTS (data injected from on-disk files only) -->
  <script>
    const CHART_DATA = ${JSON.stringify(chartData)};
    const chartOrEmpty = (id) => {
      const canvas = document.getElementById(id);
      return canvas ? canvas.getContext('2d') : null;
    };

    lucide.createIcons();

    // 1. Layer Verification Chart — real per-layer success rates (zeros when no ledger yet)
    const ctxLayers = chartOrEmpty('layersChart');
    if (ctxLayers) {
      new Chart(ctxLayers, {
        type: 'doughnut',
        data: {
          labels: ['Funcional (Tests)', 'Estático (Tipos/Lint)', 'Seguridad (SAST)', 'Arquitectura (Guard)'],
          datasets: [{
            data: CHART_DATA.layers,
            backgroundColor: ['#06B6D4', '#10B981', '#F59E0B', '#8B5CF6'],
            borderColor: '#111827',
            borderWidth: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#9CA3AF', font: { size: 10 } } }
          },
          cutout: '70%'
        }
      });
    }

    // 2. Local usage by tool — real invocations from .sdd/usage.json
    const ctxEvolution = chartOrEmpty('evolutionChart');
    if (ctxEvolution) {
      new Chart(ctxEvolution, {
        type: 'bar',
        data: {
          labels: CHART_DATA.toolLabels,
          datasets: [{
            label: 'Invocaciones',
            data: CHART_DATA.toolValues,
            backgroundColor: '#10B981',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, grid: { color: '#1F2937' }, ticks: { color: '#9CA3AF', precision: 0 } },
            x: { grid: { display: false }, ticks: { color: '#9CA3AF', font: { size: 9 } } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    // 3. Declared clients Chart (Doughnut) — only when the ledger has clients
    const ctxPlatforms = chartOrEmpty('platformsChart');
    if (ctxPlatforms) {
      new Chart(ctxPlatforms, {
        type: 'doughnut',
        data: {
          labels: CHART_DATA.clientLabels,
          datasets: [{
            data: CHART_DATA.clientValues,
            backgroundColor: ['#06B6D4', '#F59E0B', '#10B981', '#8B5CF6', '#EF4444'],
            borderColor: '#111827',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          cutout: '65%'
        }
      });
    }

    // 4. MCP Tools Traffic Chart (Bar) — same real usage ledger
    const ctxTools = chartOrEmpty('toolsChart');
    if (ctxTools) {
      new Chart(ctxTools, {
        type: 'bar',
        data: {
          labels: CHART_DATA.toolLabels,
          datasets: [{
            data: CHART_DATA.toolValues,
            backgroundColor: '#8B5CF6',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, grid: { color: '#1F2937' }, ticks: { color: '#9CA3AF', precision: 0 } },
            x: { grid: { display: false }, ticks: { color: '#9CA3AF', font: { size: 9 } } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }
  </script>
</body>
</html>
`;

  const outputPath = path.join(DOCS_DIR, 'index.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf8');
  console.log(`✅ [Dashboard Generator] Dashboard generado exitosamente en: ${outputPath}`);
  return {
    success: true,
    path: outputPath,
    total_contracts: contracts.length,
    resolved_count: resolvedCount,
    last_updated: lastUpdated,
    metrics_source: metricsSource,
    usage_source: usageSource,
    tool_calls: usage.totals.calls
  };
}

if (require.main === module) {
  generateDashboard();
}

module.exports = { generateDashboard };

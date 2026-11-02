#!/usr/bin/env node

/**
 * SDD-GL CLI — a thin shell over the same core the MCP server uses.
 *
 * Exit codes (stable contract):
 *   0  everything is fine
 *   1  findings (incomplete contract, pending work, failing validation)
 *   2  usage error
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const wantsJson = args.includes('--json');
const wantsHelp = args.includes('--help') || args.includes('-h') || args.length === 0;

function flagValue(name) {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

const positional = args.filter((arg, index) => {
  if (arg.startsWith('-')) return false;
  const previous = args[index - 1];
  return previous !== '--root' && previous !== '--out';
});

const rootFlag = flagValue('--root');
const ROOT = rootFlag ? path.resolve(rootFlag) : process.cwd();

process.env.SDD_PROJECT_ROOT = ROOT;
// The usage ledger measures MCP traffic; CLI reads must not inflate it.
process.env.SDD_TELEMETRY = 'off';

const { handleToolCall, TOOLS } = require('../mcp/server.js');

const USAGE = `SDD-GL CLI

  sdd <comando> [opciones]

Comandos:
  status                 Estado de todos los contratos y progreso del mapa
  new "<título>"         Crea un contrato nuevo (--type FEAT|FIX, --gate EXPRESS|STRICT)
  validate <ID>          Validación de Gate (checklist + contradicciones)
  next                   Qué hacer ahora, según el estado del proyecto
  report <ID>            Informe de ejecución del contrato

Opciones:
  --json                 Salida JSON (para CI y scripts)
  --root <dir>           Proyecto a inspeccionar (por defecto: cwd)
  --out <archivo>        (report) escribe el informe en un archivo
  --help                 Esta ayuda

Códigos de salida: 0 sin hallazgos · 1 con hallazgos · 2 error de uso
`;

function fail(message) {
  if (wantsJson) {
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`sdd: ${message}`);
  }
  process.exit(2);
}

function readContract(contractId) {
  const contractsDir = path.join(ROOT, 'contracts');
  if (!fs.existsSync(contractsDir)) return null;

  const files = fs.readdirSync(contractsDir).filter(name => name.toLowerCase().endsWith('.md'));
  const exact = `${contractId}.md`;
  const candidate = files.includes(exact)
    ? exact
    : files.find(name => name.endsWith(`-${contractId}.md`) || name.startsWith(`${contractId}-`))
      || files.find(name => new RegExp(`^#\\s*ID:\\s*${contractId}\\s*$`, 'm').test(
        fs.readFileSync(path.join(contractsDir, name), 'utf8').slice(0, 600)
      ));

  if (!candidate) return null;
  const fullPath = path.join(contractsDir, candidate);
  return { file: candidate, path: fullPath, text: fs.readFileSync(fullPath, 'utf8') };
}

function parseMap(text) {
  const match = text.match(/##\s+Completion Map\n([\s\S]*?)(?=\n##\s|$)/);
  if (!match) return [];

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('# ') && line.includes('|'))
    .slice(1)
    .map(line => {
      const parts = line.replace(/^#\s*/, '').split('|').map(part => part.trim());
      const status = parts[parts.length - 1];
      const hasLayer = parts.length >= 5;
      return {
        item: parts[0],
        layer: hasLayer ? parts[1] : 'functional',
        testId: hasLayer ? parts[2] : parts[1],
        agent: hasLayer ? parts[3] : parts[2],
        status
      };
    });
}

function readRunLogs(contractId) {
  const runsDir = path.join(ROOT, '.sdd', 'runs');
  if (!fs.existsSync(runsDir)) return { files: [], entries: [], audits: [] };

  const dir = path.join(runsDir, contractId);
  const files = [];

  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (fs.statSync(path.join(dir, name)).isFile()) files.push(name);
    }
  }

  // Structured ledger first (append-only NDJSON); markdown logs are the fallback.
  const eventsFile = path.join(dir, 'events.ndjson');
  let entries = [];

  if (fs.existsSync(eventsFile)) {
    entries = fs.readFileSync(eventsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean)
      .map(event => ({
        file: 'events.ndjson',
        event: event.event || 'RESULT',
        item: event.item || null,
        layer: event.layer || null,
        result: event.result || null,
        timestamp: event.ts || null
      }));
  } else if (files.length > 0) {
    for (const name of files) {
      if (name === 'events.ndjson') continue;
      const content = fs.readFileSync(path.join(dir, name), 'utf8');
      const pick = key => {
        const match = content.match(new RegExp(`^#\\s*${key}:\\s*(.*)$`, 'm'));
        return match ? match[1].trim() : null;
      };
      entries.push({
        file: name,
        event: pick('Event') || 'RESULT',
        item: pick('Item'),
        layer: pick('Layer'),
        result: pick('Result'),
        timestamp: pick('Timestamp')
      });
    }
  }

  const audits = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter(name => name.startsWith(`${contractId}-`) && name.endsWith('.md'))
    : [];

  return { files, entries, audits };
}

function formatTable(rows, headers) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map(row => String(row[index]).length))
  );
  const line = cells => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
  return [line(headers), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function commandStatus() {
  const status = handleToolCall('sdd_get_status', {});
  const contracts = status.contracts || [];

  if (wantsJson) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  if (contracts.length === 0) {
    console.log('No hay contratos. Creá el primero con sdd new (o con el cliente MCP).');
    return 0;
  }

  const rows = contracts.map(contract => {
    const progress = contract.progress.total > 0
      ? `${contract.progress.done}/${contract.progress.total}`
      : '—';
    const title = contract.title.length > 52 ? `${contract.title.slice(0, 51)}…` : contract.title;
    return [contract.id, contract.type, contract.status, contract.mode, progress, title];
  });

  console.log(formatTable(rows, ['ID', 'Tipo', 'Estado', 'Modo', 'Mapa', 'Título']));
  console.log(`\n${contracts.length} contrato(s). Proyecto: ${ROOT}`);
  return 0;
}

function commandNew() {
  const title = positional[1];
  if (!title) fail('falta el título (sdd new "historia en una frase")');

  const type = (flagValue('--type') || 'FEAT').toUpperCase();
  const gateMode = flagValue('--gate') || (type === 'FIX' ? 'EXPRESS' : 'STRICT');

  const result = handleToolCall('sdd_create_contract', {
    title,
    type,
    gate_mode: gateMode,
    intent: flagValue('--intent') || title
  });

  if (result.error) fail(result.error);

  if (wantsJson) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(`✅ ${result.contract_id} creado en ${result.path}`);
  console.log(`   Gate: ${result.gate_mode} · siguiente paso: completar la spec y correr sdd validate ${result.contract_id}`);
  return 0;
}

function commandValidate() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd validate <ID>)');

  const result = handleToolCall('sdd_validate_gate', { contract_id: contractId });
  if (result.error) fail(result.error);

  if (wantsJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'READY_FOR_APPROVAL' ? 0 : 1;
  }

  const icon = result.status === 'READY_FOR_APPROVAL' ? '✅' : '⛔';
  console.log(`${icon} ${contractId} — ${result.status} (${result.type})`);

  if (result.missing && result.missing.length > 0) {
    console.log('\nFaltantes:');
    for (const issue of result.missing) console.log(`  - ${issue}`);
  }
  if (result.contradictions && result.contradictions.length > 0) {
    console.log('\nContradicciones:');
    for (const contradiction of result.contradictions) console.log(`  - ${contradiction.reason}`);
  }
  if (result.status === 'READY_FOR_APPROVAL') {
    console.log('\nSiguiente paso: aprobar el contrato (Status: APPROVED + Mode: LOOP).');
  }

  return result.status === 'READY_FOR_APPROVAL' ? 0 : 1;
}

function commandNext() {
  const status = handleToolCall('sdd_get_status', {});
  const contracts = status.contracts || [];

  const stalled = [];
  for (const contract of contracts) {
    const source = readContract(contract.id);
    if (!source) continue;
    const inProgress = parseMap(source.text).filter(item => item.status === '⏳');
    if (inProgress.length > 0) stalled.push({ contract, items: inProgress.map(item => item.item) });
  }

  const drafts = contracts.filter(contract => contract.status === 'DRAFT');
  const loops = contracts.filter(contract => contract.status === 'APPROVED');
  const resolved = contracts.filter(contract => contract.status === 'RESOLVED');

  const steps = [];

  if (stalled.length > 0) {
    for (const entry of stalled) {
      steps.push({
        action: `Reanudar ${entry.contract.id}`,
        command: `sdd loop ${entry.contract.id}`,
        why: `el ítem ${entry.items[0]} quedó en curso (⏳)`
      });
    }
  }

  for (const contract of drafts) {
    steps.push({
      action: `Validar y aprobar ${contract.id}`,
      command: `sdd validate ${contract.id}`,
      why: 'está en DRAFT/GATE'
    });
  }

  for (const contract of loops) {
    steps.push({
      action: `Ejecutar el Loop de ${contract.id}`,
      command: `sdd loop ${contract.id}`,
      why: `${contract.progress.done}/${contract.progress.total} ítems del mapa`
    });
  }

  if (steps.length === 0) {
    steps.push({
      action: 'Crear el próximo contrato',
      command: 'sdd new',
      why: resolved.length > 0 ? `${resolved.length} contrato(s) resueltos, nada pendiente` : 'no hay contratos'
    });
  }

  if (wantsJson) {
    console.log(JSON.stringify({ next: steps, summary: { drafts: drafts.length, loops: loops.length, resolved: resolved.length } }, null, 2));
    return 0;
  }

  console.log('Qué hacer ahora:\n');
  steps.forEach((step, index) => {
    console.log(`${index + 1}. ${step.action}`);
    console.log(`   por qué: ${step.why}`);
    console.log(`   comando: ${step.command}\n`);
  });
  return 0;
}

function commandReport() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd report <ID>)');

  const source = readContract(contractId);
  if (!source) fail(`contrato ${contractId} no encontrado en ${path.join(ROOT, 'contracts')}`);

  const text = source.text;
  const header = key => {
    const match = text.match(new RegExp(`^#\\s*${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : '—';
  };

  const items = parseMap(text);
  const done = items.filter(item => item.status === '✅').length;
  const runs = readRunLogs(contractId);
  const metrics = handleToolCall('sdd_get_metrics', {});

  const claims = runs.entries.filter(entry => entry.event === 'CLAIM').length;
  const passes = runs.entries.filter(entry => entry.result === 'PASS').length;
  const fails = runs.entries.filter(entry => entry.result === 'FAIL').length;

  const lines = [];
  lines.push(`# Informe de ejecución — ${contractId}`);
  lines.push('');
  lines.push(`- **Título:** ${header('CONTRACT')}`);
  lines.push(`- **Estado:** ${header('Status')} · ${header('Mode')}`);
  lines.push(`- **Tipo:** ${header('Gate-Mode')} · archivo \`${source.file}\``);
  lines.push(`- **Progreso:** ${done}/${items.length} ítems del Completion Map`);
  lines.push(`- **Generado:** ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Criterios');
  lines.push('');
  lines.push(formatTable(
    items.map(item => [item.item, item.layer, item.agent, item.status]),
    ['Ítem', 'Capa', 'Agente', 'Estado']
  ));
  lines.push('');

  lines.push('## Ejecuciones registradas');
  lines.push('');
  if (runs.entries.length === 0) {
    lines.push('_Sin logs por ítem en `.sdd/runs/`._');
  } else {
    lines.push(formatTable(
      runs.entries
        .slice(-20)
        .map(entry => [entry.item || '—', entry.event, entry.result || '—', entry.timestamp || '—']),
      ['Ítem', 'Evento', 'Resultado', 'Timestamp']
    ));
    lines.push('');
    lines.push(`Resumen: ${claims} claims · ${passes} pass · ${fails} fail · ${runs.files.length} archivo(s) de log.`);
  }
  lines.push('');

  if (runs.audits.length > 0) {
    lines.push('## Auditorías del contrato');
    lines.push('');
    for (const audit of runs.audits) lines.push(`- \`.sdd/runs/${audit}\``);
    lines.push('');
  }

  lines.push('## Métricas del proyecto');
  lines.push('');
  lines.push(`- FPQR: ${metrics.first_pass_quality_rate}% · pasos: ${metrics.counters ? metrics.counters.steps_total : 0}`);
  lines.push(`- Reintentos promedio por contrato: ${metrics.average_retries}`);
  lines.push('');

  const verdict = done === items.length && items.length > 0
    ? 'COMPLETO: todos los ítems del mapa están ✅.'
    : `PENDIENTE: faltan ${items.length - done} ítem(s).`;
  lines.push('## Veredicto');
  lines.push('');
  lines.push(verdict);

  const markdown = lines.join('\n');
  const outFile = flagValue('--out');

  if (outFile) {
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, `${markdown}\n`, 'utf8');
    if (wantsJson) {
      console.log(JSON.stringify({ contract_id: contractId, out: path.resolve(outFile), done, total: items.length }, null, 2));
    } else {
      console.log(`Informe escrito en ${path.resolve(outFile)} (${done}/${items.length} ítems).`);
    }
  } else {
    console.log(markdown);
  }

  return done === items.length && items.length > 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

if (wantsHelp) {
  console.log(USAGE);
  process.exit(0);
}

const command = positional[0];

const commands = {
  status: commandStatus,
  new: commandNew,
  validate: commandValidate,
  next: commandNext,
  report: commandReport,
  tools: () => {
    if (wantsJson) {
      console.log(JSON.stringify(TOOLS.map(tool => tool.name), null, 2));
    } else {
      console.log(TOOLS.map(tool => tool.name).join('\n'));
    }
    return 0;
  }
};

if (!command) {
  console.log(USAGE);
  process.exit(0);
}

if (!Object.prototype.hasOwnProperty.call(commands, command)) {
  fail(`comando desconocido: ${command}\n\n${USAGE}`);
}

process.exit(commands[command]());

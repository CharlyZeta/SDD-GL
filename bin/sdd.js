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

const { handleToolCall, TOOLS, isContractText, looksLikeContract } = require('../mcp/server.js');

// CLI usage is real usage of the methodology: it is counted and attributed to the
// contract type it serves (feature/fix) when a contract is involved.
function inferContractType(contractId) {
  if (!contractId) return null;
  const source = readContract(contractId);
  if (!source) return /FIX/i.test(contractId) ? 'fix' : null;

  const frontMatter = source.text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontMatter) {
    const declared = frontMatter[1].match(/^\s*type\s*:\s*(\w+)/im);
    if (declared) return declared[1].toLowerCase();
  }

  const haystack = `${contractId} ${source.file}`.toUpperCase();
  if (/FIX-\d/.test(haystack)) return 'fix';
  if (/FEAT-\d/.test(haystack)) return 'feature';
  return null;
}

function callTool(name, args, command, contractId) {
  return handleToolCall(name, args, {
    source: 'cli',
    command,
    type: inferContractType(contractId)
  });
}

const USAGE = `SDD-GL CLI

  sdd <comando> [opciones]

Comandos:
  init                   Prepara el proyecto (.sdd/config.json, contracts/, CONSTITUTION.md)
  status                 Estado de todos los contratos y progreso del mapa
  new "<título>"         Crea un contrato nuevo (--type FEAT|FIX, --gate EXPRESS|STRICT)
  validate <ID>          Validación de Gate (checklist + contradicciones)
  next                   Qué hacer ahora (respeta dependencias)
  report <ID>            Informe de ejecución del contrato
  approve <ID> --yes     Aprueba el contrato (HO-Gate) con huella del spec
  loop <ID>              Reclama el próximo ítem (--item/--layer; --pass/--fail/--blocked para reportar)
  graph                  Orden de ejecución según depends_on
  split <ID>             Propone el corte de un contrato sobredimensionado (--write crea borradores)
  reconcile <ID>         Reinicia solo los ítems cuyo criterio cambió en el spec
  review                 Cobertura BR/AC por contrato (heatmap sobre el corpus de tests)
  sync                   Verifica que cada agente exista en todas las plataformas
  doctor                 Diagnóstico de la instalación

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
  const status = callTool('sdd_get_status', {}, 'status', null);
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
  }, {
    source: 'cli',
    command: 'new',
    type: type === 'FIX' ? 'fix' : 'feature'
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

  const result = callTool('sdd_validate_gate', { contract_id: contractId }, 'validate', contractId);
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
  const status = callTool('sdd_get_status', {}, 'next', null);
  const contracts = status.contracts || [];

  // Dependencies gate the suggestions: a contract is actionable only when every
  // dependency is RESOLVED (or the dependency does not exist, which is reported).
  const dependencyMap = new Map(contracts.map(contract => [contract.id, readDependencies(contract.id)]));
  const blockingDependencies = contract => (dependencyMap.get(contract.id) || []).filter(dependency => {
    const target = contracts.find(item => item.id === dependency);
    return !target || target.status !== 'RESOLVED';
  });

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

  const actionable = contract => blockingDependencies(contract).length === 0;
  const blocked = [...drafts, ...loops].filter(contract => !actionable(contract));

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

  for (const contract of drafts.filter(actionable)) {
    steps.push({
      action: `Validar y aprobar ${contract.id}`,
      command: `sdd validate ${contract.id}`,
      why: 'está en DRAFT/GATE'
    });
  }

  const stalledIds = new Set(stalled.map(entry => entry.contract.id));
  for (const contract of loops.filter(actionable).filter(item => !stalledIds.has(item.id))) {
    steps.push({
      action: `Ejecutar el Loop de ${contract.id}`,
      command: `sdd loop ${contract.id}`,
      why: `${contract.progress.done}/${contract.progress.total} ítems del mapa`
    });
  }

  for (const contract of blocked) {
    steps.push({
      action: `Esperar ${contract.id}`,
      command: `sdd graph`,
      why: `depende de ${blockingDependencies(contract).join(', ')}`
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
    console.log(JSON.stringify({ next: steps, summary: { drafts: drafts.length, loops: loops.length, resolved: resolved.length, blocked: blocked.length } }, null, 2));
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
  const metrics = callTool('sdd_get_metrics', {}, 'report', contractId);

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
// Init and doctor
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  schema_version: 1,
  layers: ['functional', 'static', 'security', 'arch'],
  suite: null,
  suite_policy: 'on_resolve',
  timeout_seconds: 300
};

const CONSTITUTION_TEMPLATE = `# Constitución del proyecto

## Principios Arquitectónicos
- [Reglas no negociables: capas, dependencias permitidas, límites.]

## Estándares de Seguridad
- [Manejo de secretos, datos personales y dependencias.]
`;

function commandInit() {
  const created = [];
  const skipped = [];

  const contractsDir = path.join(ROOT, 'contracts');
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
    created.push('contracts/');
  } else {
    skipped.push('contracts/');
  }

  const sddDir = path.join(ROOT, '.sdd');
  fs.mkdirSync(sddDir, { recursive: true });

  const configPath = path.join(sddDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
    created.push('.sdd/config.json');
  } else {
    skipped.push('.sdd/config.json');
  }

  const constitutionPath = path.join(ROOT, 'CONSTITUTION.md');
  if (!fs.existsSync(constitutionPath)) {
    fs.writeFileSync(constitutionPath, CONSTITUTION_TEMPLATE, 'utf8');
    created.push('CONSTITUTION.md');
  } else {
    skipped.push('CONSTITUTION.md');
  }

  if (args.includes('--private')) {
    const gitignorePath = path.join(ROOT, '.gitignore');
    const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    const wanted = ['contracts/*', '!contracts/.gitkeep', '.sdd/'];
    const missing = wanted.filter(line => !current.split(/\r?\n/).map(l => l.trim()).includes(line));

    if (missing.length > 0) {
      const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(gitignorePath, `${current}${prefix}\n# Trabajo SDD-GL privado\n${missing.join('\n')}\n`, 'utf8');
      created.push(`.gitignore (+${missing.length})`);
    } else {
      skipped.push('.gitignore');
    }
  }

  if (wantsJson) {
    console.log(JSON.stringify({ root: ROOT, created, skipped }, null, 2));
    return 0;
  }

  console.log(`Proyecto inicializado en ${ROOT}`);
  if (created.length > 0) created.forEach(item => console.log(`  + ${item}`));
  if (skipped.length > 0) skipped.forEach(item => console.log(`  = ${item} (sin cambios)`));
  console.log('\nSiguiente paso: sdd new "tu primera historia"');
  return 0;
}

function commandDoctor() {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('node', 'OK', `v${process.versions.node}`);
  else add('node', 'FAIL', `se requiere Node >= 18 (actual v${process.versions.node})`);

  const contractsDir = path.join(ROOT, 'contracts');
  if (fs.existsSync(contractsDir)) add('contracts', 'OK', contractsDir);
  else add('contracts', 'WARN', 'no existe contracts/ — creá el primero con sdd new');

  const configPath = path.join(ROOT, '.sdd', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const layers = Array.isArray(config.layers) ? config.layers.join(', ') : 'default';
      add('config', 'OK', `capas: ${layers}`);
    } catch (error) {
      add('config', 'FAIL', `.sdd/config.json inválido: ${error.message}`);
    }
  } else {
    add('config', 'WARN', 'sin .sdd/config.json — se usan los valores por defecto (sdd init)');
  }

  const unreadable = [];
  const stalled = [];
  const ignored = [];
  let contracts = 0;

  if (fs.existsSync(contractsDir)) {
    for (const name of fs.readdirSync(contractsDir).filter(entry => entry.toLowerCase().endsWith('.md'))) {
      const text = fs.readFileSync(path.join(contractsDir, name), 'utf8');

      // `contracts/` may also hold a README or notes: only files with a contract
      // header are counted, and only a broken contract header is a failure.
      if (!isContractText(text)) {
        if (looksLikeContract(text)) unreadable.push(name);
        else ignored.push(name);
        continue;
      }

      contracts += 1;
      if (/^\s*#.*\|\s*⏳\s*$/m.test(text)) stalled.push(name);
    }
  }

  if (unreadable.length > 0) add('contratos', 'FAIL', `encabezado ilegible: ${unreadable.join(', ')}`);
  else add('contratos', 'OK', `${contracts} contrato(s) legibles${ignored.length ? ` · ignorados: ${ignored.join(', ')}` : ''}`);

  if (stalled.length > 0) add('en curso', 'WARN', `ítems en ⏳ (reanudar): ${stalled.join(', ')}`);
  else add('en curso', 'OK', 'sin ítems interrumpidos');

  add('mcp', 'OK', `${TOOLS.length} herramientas disponibles`);

  const agentsDir = path.join(ROOT, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    const withoutFrontMatter = fs.readdirSync(agentsDir)
      .filter(name => name.endsWith('.md'))
      .filter(name => !fs.readFileSync(path.join(agentsDir, name), 'utf8').startsWith('---'));

    if (withoutFrontMatter.length > 0) {
      add('agentes', 'WARN', `sin frontmatter: ${withoutFrontMatter.join(', ')}`);
    } else {
      add('agentes', 'OK', 'frontmatter completo');
    }
  }

  const hasFailure = checks.some(check => check.status === 'FAIL');

  if (wantsJson) {
    console.log(JSON.stringify({ root: ROOT, checks, ok: !hasFailure }, null, 2));
    return hasFailure ? 1 : 0;
  }

  for (const check of checks) {
    const icon = check.status === 'OK' ? '✓' : check.status === 'WARN' ? '!' : '✗';
    console.log(`[${icon}] ${check.name.padEnd(10)} ${check.detail}`);
  }
  console.log(hasFailure ? '\nHay fallas que impiden el flujo normal.' : '\nDiagnóstico sin fallas.');
  return hasFailure ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Approve (HO-Gate from the terminal)
// ---------------------------------------------------------------------------

function commandApprove() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd approve <ID>)');

  const source = readContract(contractId);
  if (!source) fail(`contrato ${contractId} no encontrado`);

  const validation = callTool('sdd_validate_gate', { contract_id: contractId }, 'approve', contractId);
  if (validation.status !== 'READY_FOR_APPROVAL') {
    if (!wantsJson) {
      console.log(`⛔ ${contractId} no está listo para aprobar (${validation.status}).`);
      for (const issue of validation.missing || []) console.log(`  - ${issue}`);
    } else {
      console.log(JSON.stringify({ contract_id: contractId, approved: false, validation }, null, 2));
    }
    return 1;
  }

  // Explicit confirmation: the CLI never approves silently.
  if (!args.includes('--yes')) {
    if (wantsJson) {
      console.log(JSON.stringify({ contract_id: contractId, approved: false, reason: 'confirmation required (--yes)' }, null, 2));
      return 2;
    }
    fail('la aprobación requiere confirmación explícita: agregá --yes');
  }

  const crypto = require('node:crypto');

  // Hash only the spec body: approval lines and mode/status headers are excluded,
  // so re-approving the same content produces the same fingerprint.
  const canonical = source.text
    .split(/\r?\n/)
    .filter(line => !/^#\s*(Status|Mode|Approved-By|Approved-At|Approved-Hash):/.test(line))
    .join('\n')
    .trim();

  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  const approvedBy = (() => {
    try {
      const { execSync } = require('node:child_process');
      const name = execSync('git config user.name', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const email = execSync('git config user.email', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (name) return email ? `${name} <${email}>` : name;
    } catch (error) {
      // Not a git repository: fall back to the OS user below.
    }

    try {
      return require('node:os').userInfo().username;
    } catch (error) {
      return 'desconocido';
    }
  })();

  let text = source.text
    .replace(/^#\s*Status:\s*DRAFT\s*$/m, '# Status: APPROVED')
    .replace(/^#\s*Mode:\s*GATE\s*$/m, '# Mode: LOOP')
    .replace(/^#\s*Approved-(By|At|Hash):.*$\r?\n?/gm, '');

  const header = `# Approved-By: ${approvedBy}\n# Approved-At: ${new Date().toISOString()}\n# Approved-Hash: ${hash}`;
  text = text.replace(/^(#\s*Gate-Mode:.*)$/m, `$1\n${header}`);

  fs.writeFileSync(source.path, text, 'utf8');

  if (wantsJson) {
    console.log(JSON.stringify({ contract_id: contractId, approved: true, approved_by: approvedBy, hash }, null, 2));
    return 0;
  }

  console.log(`✅ ${contractId} aprobado — Status: APPROVED · Mode: LOOP`);
  console.log(`   por: ${approvedBy}`);
  console.log(`   hash del spec: ${hash}`);
  console.log(`\nSiguiente paso: sdd loop ${contractId}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Sync check: the same agents must exist for every platform adapter
// ---------------------------------------------------------------------------

function commandSync() {
  const skillsDir = path.join(ROOT, '.agents', 'skills');
  const agentsDir = path.join(ROOT, '.claude', 'agents');
  const issues = [];
  const pairs = [];

  const skillDirs = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    : [];

  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter(name => name.endsWith('.md'))
    : [];

  // Only agent skills have a Claude Code counterpart; orchestrator skills do not.
  const agentSkills = skillDirs.filter(name => /^sdd-.*-agent$/.test(name));

  for (const skill of agentSkills) {
    const expected = `${skill.replace(/^sdd-/, '')}.md`;
    if (!agentFiles.includes(expected)) {
      issues.push(`falta .claude/agents/${expected} para .agents/skills/${skill}`);
    } else {
      pairs.push({ skill, agent: expected });
    }
  }

  for (const agent of agentFiles) {
    const expectedSkill = `sdd-${agent.replace(/\.md$/, '')}`;
    if (!skillDirs.includes(expectedSkill)) {
      issues.push(`falta .agents/skills/${expectedSkill} para .claude/agents/${agent}`);
    }
  }

  const payload = { root: ROOT, pairs: pairs.length, issues };

  if (wantsJson) {
    console.log(JSON.stringify(payload, null, 2));
    return issues.length === 0 ? 0 : 1;
  }

  if (issues.length === 0) {
    console.log(`✅ ${pairs.length} par(es) de agente sincronizados entre .agents/skills y .claude/agents.`);
  } else {
    console.log('⛔ Diferencias entre plataformas:');
    for (const issue of issues) console.log(`  - ${issue}`);
  }

  return issues.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Loop from the terminal and dependency graph
// ---------------------------------------------------------------------------

function readDependencies(contractId) {
  const source = readContract(contractId);
  if (!source) return [];

  const frontMatter = source.text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontMatter) {
    const line = frontMatter[1].match(/^\s*depends_on\s*:\s*(.+)$/im);
    if (line) {
      return line[1]
        .replace(/[[\]]/g, ' ')
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter(item => /^(?:FEAT|FIX)-\d+$/.test(item));
    }
  }

  const section = source.text.match(/^##\s*(?:Depends On|Depende de)\s*\n([\s\S]*?)(?=\n##\s|$)/im);
  if (section) {
    return [...new Set([...section[1].matchAll(/\b(?:FEAT|FIX)-\d+\b/g)].map(match => match[0]))];
  }

  return [];
}

function buildDependencyGraph() {
  const status = callTool('sdd_get_status', {}, 'graph', null);
  const contracts = status.contracts || [];
  const byId = new Map(contracts.map(contract => [contract.id, contract]));

  const nodes = contracts.map(contract => ({
    id: contract.id,
    status: contract.status,
    title: contract.title,
    dependsOn: readDependencies(contract.id)
  }));

  const missing = [];
  for (const node of nodes) {
    node.dependsOn = node.dependsOn.filter(dependency => {
      if (!byId.has(dependency)) {
        missing.push(`${node.id} -> ${dependency}`);
        return false;
      }
      return true;
    });
  }

  // Kahn topological order; whatever remains belongs to a cycle.
  const indegree = new Map(nodes.map(node => [node.id, node.dependsOn.length]));
  const dependents = new Map(nodes.map(node => [node.id, []]));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) dependents.get(dependency).push(node.id);
  }

  const queue = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id).sort();
  const order = [];

  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const dependent of dependents.get(id)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) queue.push(dependent);
    }
  }

  const cyclic = nodes.map(node => node.id).filter(id => !order.includes(id));
  const ready = nodes
    .filter(node => node.status !== 'RESOLVED')
    .filter(node => node.dependsOn.every(dependency => byId.get(dependency).status === 'RESOLVED'))
    .map(node => node.id);

  return { nodes, order, cyclic, missing, ready, byId };
}

function commandGraph() {
  const graph = buildDependencyGraph();

  if (wantsJson) {
    console.log(JSON.stringify({
      order: graph.order,
      ready: graph.ready,
      cyclic: graph.cyclic,
      missing: graph.missing,
      nodes: graph.nodes
    }, null, 2));
    return graph.cyclic.length > 0 || graph.missing.length > 0 ? 1 : 0;
  }

  console.log('Orden sugerido (dependencias primero):\n');
  for (const id of graph.order) {
    const node = graph.nodes.find(item => item.id === id);
    const deps = node.dependsOn.length > 0 ? ` <- ${node.dependsOn.join(', ')}` : '';
    console.log(`  ${id.padEnd(11)} ${node.status.padEnd(9)}${deps}`);
  }

  if (graph.ready.length > 0) console.log(`\nListos para avanzar: ${graph.ready.join(', ')}`);
  if (graph.cyclic.length > 0) console.log(`\nCiclo de dependencias: ${graph.cyclic.join(', ')}`);
  if (graph.missing.length > 0) console.log(`\nDependencias inexistentes: ${graph.missing.join(', ')}`);
  if (graph.ready.length === 0 && graph.cyclic.length === 0) {
    console.log('\nNada listo: todo depende de trabajo pendiente o está resuelto.');
  }

  return graph.cyclic.length > 0 || graph.missing.length > 0 ? 1 : 0;
}

function commandLoop() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd loop <ID>)');

  const wantsPass = args.includes('--pass');
  const wantsFail = args.includes('--fail');
  const blockedReason = flagValue('--blocked');
  const evidence = flagValue('--evidence') || '';

  if (blockedReason) {
    const result = callTool('sdd_log_ambiguity', {
      contract_id: contractId,
      item_id: flagValue('--item') || 'auto',
      reason: blockedReason
    }, 'loop', contractId);

    if (result.error) fail(result.error);
    if (wantsJson) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`Ambiguedad registrada en ${contractId}. El contrato volvio a DRAFT/GATE.`);
    console.log(`   motivo: ${blockedReason}`);
    return 0;
  }

  if (wantsPass || wantsFail) {
    const result = callTool('sdd_step_loop', {
      contract_id: contractId,
      item_id: flagValue('--item') || 'auto',
      result: wantsPass ? 'PASS' : 'FAIL',
      evidence: evidence || '(sin evidencia)',
      layer: flagValue('--layer') || undefined
    }, 'loop', contractId);

    if (result.error) fail(result.error);

    if (wantsJson) {
      console.log(JSON.stringify(result, null, 2));
      return result.item_status === 'PASS' ? 0 : 1;
    }

    const icon = result.item_status === 'PASS' ? 'OK' : 'FALLA';
    console.log(`[${icon}] ${result.item_id}: ${result.previous_status} -> ${result.new_status} (${result.item_status})`);
    console.log(`   evidencia: ${evidence || '-'}`);
    console.log(`   log: ${result.audit_log_path || '-'}`);
    return result.item_status === 'PASS' ? 0 : 1;
  }

  // Default: claim the next item and hand its context to the agent.
  const claim = callTool('sdd_step_loop', {
    contract_id: contractId,
    item_id: flagValue('--item') || 'auto',
    layer: flagValue('--layer') || undefined
  }, 'loop', contractId);

  if (claim.error) fail(claim.error);

  if (claim.item_status !== 'IN_PROGRESS') {
    if (wantsJson) {
      console.log(JSON.stringify(claim, null, 2));
      return 1;
    }
    console.log(`No se pudo reclamar un item: ${claim.reason || claim.item_status}`);
    return 1;
  }

  if (wantsJson) {
    console.log(JSON.stringify(claim, null, 2));
    return 0;
  }

  console.log(`>> ${contractId} - item reclamado: ${claim.item_id} (${claim.layer})`);
  console.log(`   criterio: ${claim.criterion || '(ver el contrato)'}`);
  console.log(`   agente: ${claim.agent} - test: ${claim.test_id}`);
  console.log(`\n   ${claim.next_action}`);
  console.log(`\n   Al terminar:  sdd loop ${contractId} --pass --evidence "resultado"`);
  console.log(`   Si falla:     sdd loop ${contractId} --fail --evidence "salida"`);
  console.log(`   Si bloquea:   sdd loop ${contractId} --blocked "que decision falta"`);
  return 0;
}

// ---------------------------------------------------------------------------
// Split: propose the cut of an oversized contract
// ---------------------------------------------------------------------------

const SPLIT_BUDGET = { businessRules: 7, acceptanceCriteria: 8, alternativeFlows: 5 };

function readCriteria(text) {
  const lines = text.split(/\r?\n/);

  const section = names => {
    const start = lines.findIndex(line =>
      names.some(name => line.trim().toLowerCase() === ('## ' + name).toLowerCase())
    );
    if (start === -1) return [];
    const out = [];
    for (let index = start + 1; index < lines.length && !lines[index].startsWith('## '); index += 1) {
      out.push(lines[index]);
    }
    return out;
  };

  const collect = (names, prefix) => section(names)
    .map(line => line.trim())
    .filter(line => new RegExp('^- ' + prefix + '-\\d+:').test(line))
    .map(line => ({ id: line.match(new RegExp(prefix + '-\\d+'))[0], line }));

  const entities = section(['Entities Affected', 'Entidades Afectadas'])
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2));

  return {
    businessRules: collect(['Business Rules', 'Reglas de Negocio'], 'BR'),
    acceptanceCriteria: collect(['Acceptance Criteria', 'Criterios de Aceptación'], 'AC'),
    alternativeFlows: collect(['Alternative Flows', 'Flujos Alternativos'], 'AF'),
    entities
  };
}

function entityForCriterion(line, entities) {
  const haystack = line.toLowerCase();
  const matches = entities.filter(entity => {
    const raw = entity.split(':')[0].replace(/[`*]/g, '').trim();
    const name = path.basename(raw).replace(/\.[a-z]+$/, '').toLowerCase();
    return name.length >= 4 && haystack.includes(name);
  });

  return matches.length === 1 ? matches[0] : null;
}

function splitByEntity(criteria) {
  const groups = new Map();
  const shared = [];

  const buckets = {
    businessRules: criteria.businessRules,
    acceptanceCriteria: criteria.acceptanceCriteria,
    alternativeFlows: criteria.alternativeFlows
  };

  for (const [kind, list] of Object.entries(buckets)) {
    for (const item of list) {
      const entity = entityForCriterion(item.line, criteria.entities);
      if (!entity) {
        shared.push({ kind, item });
        continue;
      }
      if (!groups.has(entity)) {
        groups.set(entity, { entity, businessRules: [], acceptanceCriteria: [], alternativeFlows: [] });
      }
      groups.get(entity)[kind].push(item);
    }
  }

  return { groups: [...groups.values()], shared };
}

function chunkByBudget(criteria) {
  const total = criteria.businessRules.length + criteria.acceptanceCriteria.length;
  if (total === 0) return [];

  const parts = Math.max(
    Math.ceil(criteria.businessRules.length / SPLIT_BUDGET.businessRules),
    Math.ceil(criteria.acceptanceCriteria.length / SPLIT_BUDGET.acceptanceCriteria),
    2
  );

  // Contiguous slices keep related rules together, unlike round-robin.
  const sliceInto = (list, count) => {
    const size = Math.ceil(list.length / count) || 1;
    return Array.from({ length: count }, (_, index) => list.slice(index * size, (index + 1) * size));
  };

  const brChunks = sliceInto(criteria.businessRules, parts);
  const acChunks = sliceInto(criteria.acceptanceCriteria, parts);
  const afChunks = sliceInto(criteria.alternativeFlows, parts);

  return Array.from({ length: parts }, (_, index) => ({
    businessRules: brChunks[index] || [],
    acceptanceCriteria: acChunks[index] || [],
    alternativeFlows: afChunks[index] || []
  })).filter(chunk =>
    chunk.businessRules.length + chunk.acceptanceCriteria.length + chunk.alternativeFlows.length > 0
  );
}

function buildSplitPlan(contractId) {
  const source = readContract(contractId);
  if (!source) return null;

  const text = source.text;
  const criteria = readCriteria(text);
  const overBudget =
    criteria.businessRules.length > SPLIT_BUDGET.businessRules ||
    criteria.acceptanceCriteria.length > SPLIT_BUDGET.acceptanceCriteria ||
    criteria.alternativeFlows.length > SPLIT_BUDGET.alternativeFlows;

  const byEntity = splitByEntity(criteria);
  let reason = null;
  let parts = [];

  if (byEntity.groups.length >= 2) {
    reason = 'multi-component';
    parts = byEntity.groups.map(group => ({ ...group }));
    // Shared criteria travel with the first part so nothing is lost.
    for (const entry of byEntity.shared) parts[0][entry.kind].push(entry.item);
  } else if (overBudget) {
    reason = 'budget';
    parts = chunkByBudget(criteria).map(chunk => ({ entity: null, ...chunk }));
  }

  return {
    contract_id: contractId,
    file: source.file,
    status: (text.match(/^#\s*Status:\s*(\w+)/m) || [])[1] || 'UNKNOWN',
    counts: {
      businessRules: criteria.businessRules.length,
      acceptanceCriteria: criteria.acceptanceCriteria.length,
      alternativeFlows: criteria.alternativeFlows.length,
      entities: criteria.entities.length
    },
    overBudget,
    reason,
    parts
  };
}

function nextIds(type, count) {
  const { computeNextContractId } = require('../mcp/server.js');
  const contractsDir = path.join(ROOT, 'contracts');
  const files = fs.existsSync(contractsDir) ? fs.readdirSync(contractsDir) : [];

  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(computeNextContractId([...files, ...ids.map(item => `${item}.md`)], type));
  }
  return ids;
}

function renderSplitPlan(plan, ids) {
  const lines = [];
  lines.push(`${plan.contract_id} — ${plan.counts.businessRules} BR · ${plan.counts.acceptanceCriteria} AC · ${plan.counts.alternativeFlows} AF · ${plan.counts.entities} entidad(es)`);
  lines.push(`Motivo: ${plan.reason === 'multi-component' ? 'toca varios componentes' : 'excede el presupuesto'}${plan.overBudget ? ' (sobre presupuesto)' : ''}`);
  lines.push('');
  lines.push(`Propuesta: ${plan.parts.length} contrato(s)`);

  plan.parts.forEach((part, index) => {
    const label = part.entity ? part.entity.split(':')[0].replace(/[`*]/g, '').trim() : `parte ${index + 1}`;
    lines.push('');
    lines.push(`  ${ids[index]}  ${label}`);
    if (part.businessRules.length) lines.push(`    BR: ${part.businessRules.map(item => item.id).join(', ')}`);
    if (part.acceptanceCriteria.length) lines.push(`    AC: ${part.acceptanceCriteria.map(item => item.id).join(', ')}`);
    if (part.alternativeFlows.length) lines.push(`    AF: ${part.alternativeFlows.map(item => item.id).join(', ')}`);
  });

  lines.push('');
  lines.push('Cada parte conserva la User Story del padre y necesita una propia antes de aprobarse.');
  lines.push('Agregá --write para crear los borradores.');
  return lines.join('\n');
}

function commandSplit() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd split <ID>)');

  const plan = buildSplitPlan(contractId);
  if (!plan) fail(`contrato ${contractId} no encontrado`);

  if (!plan.reason) {
    if (wantsJson) {
      console.log(JSON.stringify({ contract_id: contractId, needs_split: false, counts: plan.counts }, null, 2));
    } else {
      console.log(`✅ ${contractId} ya es atómico: ${plan.counts.businessRules} BR, ${plan.counts.acceptanceCriteria} AC, ${plan.counts.alternativeFlows} AF, ${plan.counts.entities} entidad(es).`);
    }
    return 0;
  }

  const type = /^FIX/i.test(plan.file) || /^FIX-/i.test(contractId) ? 'FIX' : 'FEAT';
  const ids = nextIds(type, plan.parts.length);

  if (wantsJson) {
    console.log(JSON.stringify({ ...plan, needs_split: true, proposed_ids: ids }, null, 2));
  } else {
    console.log(renderSplitPlan(plan, ids));
  }

  if (!args.includes('--write')) return 0;

  const parent = readContract(contractId);
  const gateMode = (parent.text.match(/^#\s*Gate-Mode:\s*(\w+)/m) || [])[1] || 'STRICT';

  plan.parts.forEach((part, index) => {
    const id = ids[index];
    const label = part.entity ? part.entity.split(':')[0].replace(/[`*]/g, '').trim() : `parte ${index + 1} de ${plan.parts.length}`;
    const body = `# CONTRACT: ${label}
# ID: ${id}
# Status: DRAFT
# Mode: GATE
# Gate-Mode: ${gateMode}
# Split-From: ${contractId}

## Intent
Parte ${index + 1} de ${plan.parts.length} del contrato ${contractId}: ${label}.

## User Story
- Como: [completar]
- Quiero: ${label}
- Para: [completar]

## Use Case
**Actor:** [completar]
**Goal:** ${label}

### Main Flow
1. [completar el flujo de esta parte]
2. [completar]
3. [completar]

### Alternative Flows
${part.alternativeFlows.length ? part.alternativeFlows.map(item => item.line).join('\n') : '- AF-01: [condición] -> [resultado]'}

## Business Rules
${part.businessRules.length ? part.businessRules.map(item => item.line).join('\n') : '- BR-001: [invariante verificable]'}

## Acceptance Criteria
${part.acceptanceCriteria.length ? part.acceptanceCriteria.map(item => item.line).join('\n') : '- AC-001: GIVEN [contexto] WHEN [acción] THEN [resultado esperado]'}

## Entities Affected
${part.entity ? `- ${part.entity}` : '- [entidad]'}

## Ambiguity Log
- [x] Ninguno
`;
    fs.writeFileSync(path.join(ROOT, 'contracts', `${id}.md`), body, 'utf8');
  });

  // The parent keeps a trace of the split instead of silently losing the criteria.
  const splitSection = `\n## Splits\n${ids.map((id, index) => `- ${id}: ${plan.parts[index].entity || `parte ${index + 1}`}`).join('\n')}\n`;
  const parentText = parent.text.includes('\n## Splits')
    ? parent.text.replace(/\n## Splits[\s\S]*$/, splitSection)
    : `${parent.text.trimEnd()}\n${splitSection}`;
  fs.writeFileSync(parent.path, parentText, 'utf8');

  if (!wantsJson) console.log(`\nBorradores creados: ${ids.join(', ')}`);
  return 0;
}

function commandReconcile() {
  const contractId = positional[1];
  if (!contractId) fail('falta el ID del contrato (sdd reconcile <ID>)');

  const { reconcileContract } = require('../mcp/server.js');
  const result = reconcileContract(contractId);
  if (result.error) fail(result.error);

  if (wantsJson) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (!result.changed) {
    console.log(`${contractId}: sin cambios — el mapa coincide con el spec.`);
    return 0;
  }

  console.log(`${contractId}: ${result.modified} modificado(s) · ${result.added} agregado(s) · ${result.removed} eliminado(s)`);
  for (const change of result.changes) {
    console.log(`  ${change.item}${change.layer ? ` (${change.layer})` : ''}: ${change.change}`);
  }
  console.log('\nLos ítems reiniciados vuelven a ❌ y se re-ejecutan en el próximo Loop.');
  return 0;
}

// ---------------------------------------------------------------------------
// Review: coverage heatmap across contracts
// ---------------------------------------------------------------------------

const TEST_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.java', '.py'];

function configuredTestDirs() {
  const configPath = path.join(ROOT, '.sdd', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (Array.isArray(config.test_dirs) && config.test_dirs.length > 0) return config.test_dirs;
    } catch (error) {
      // Invalid config: fall back to the defaults.
    }
  }
  return ['test-sandbox', 'tests', 'test'];
}

function collectTestCorpus() {
  const files = [];

  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (TEST_EXTENSIONS.some(extension => entry.name.endsWith(extension))) {
        const text = fs.readFileSync(full, 'utf8');
        const titles = [];
        for (const match of text.matchAll(/\b(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
          titles.push(match[1]);
        }
        files.push({ file: path.relative(ROOT, full), text, titles });
      }
    }
  };

  for (const dir of configuredTestDirs()) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }

  return files;
}

function coverageBar(ratio, width = 14) {
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function commandReview() {
  const contractsDir = path.join(ROOT, 'contracts');
  if (!fs.existsSync(contractsDir)) fail(`no existe ${contractsDir}`);

  const corpus = collectTestCorpus();
  const rows = [];

  for (const file of fs.readdirSync(contractsDir).filter(name => name.toLowerCase().endsWith('.md'))) {
    const text = fs.readFileSync(path.join(contractsDir, file), 'utf8');
    if (!isContractText(text)) continue;
    const id = (text.match(/^#\s*ID:\s*(\S+)\s*$/m) || [])[1] || file.replace(/\.md$/, '');
    const status = (text.match(/^#\s*Status:\s*(\w+)\s*$/m) || [])[1] || 'UNKNOWN';
    const criteria = readCriteria(text);

    const items = [
      ...criteria.businessRules.map(item => ({ kind: 'BR', id: item.id })),
      ...criteria.acceptanceCriteria.map(item => ({ kind: 'AC', id: item.id }))
    ];
    if (items.length === 0) continue;

    // A test only counts for this contract when the file names the contract, so
    // two contracts sharing `BR-001` do not absorb each other's coverage.
    const scoped = corpus.filter(entry => new RegExp(`\\b${id}\\b`).test(entry.text));
    const scopedTitles = scoped.flatMap(entry => entry.titles).join('\n');

    const covered = items.filter(item =>
      scoped.length > 0 && new RegExp(`\\b${item.id}\\b`).test(scopedTitles)
    );
    const orphans = items.filter(item => !covered.includes(item));

    rows.push({
      id,
      status,
      scoped: scoped.length > 0,
      scopedFiles: scoped.length,
      total: items.length,
      covered: covered.length,
      brTotal: criteria.businessRules.length,
      brCovered: covered.filter(item => item.kind === 'BR').length,
      acTotal: criteria.acceptanceCriteria.length,
      acCovered: covered.filter(item => item.kind === 'AC').length,
      orphans: orphans.map(item => item.id)
    });
  }

  rows.sort((a, b) => (a.covered / a.total) - (b.covered / b.total) || a.id.localeCompare(b.id));

  const totalCriteria = rows.reduce((sum, row) => sum + row.total, 0);
  const totalCovered = rows.reduce((sum, row) => sum + row.covered, 0);
  const orphanCriteria = rows.flatMap(row => row.orphans.map(orphan => `${row.id}:${orphan}`));

  const payload = {
    root: ROOT,
    corpus: { dirs: configuredTestDirs(), files: corpus.length },
    summary: {
      contracts: rows.length,
      criteria: totalCriteria,
      covered: totalCovered,
      orphans: totalCriteria - totalCovered,
      coverage: totalCriteria > 0 ? Math.round((totalCovered / totalCriteria) * 1000) / 10 : 0,
      unscoped: rows.filter(row => !row.scoped).length
    },
    contracts: rows,
    orphan_specs: orphanCriteria
  };

  if (wantsJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    if (rows.length === 0) {
      console.log('No hay contratos con criterios BR/AC.');
      return 0;
    }

    console.log(`Cobertura por contrato · corpus: ${corpus.length} archivo(s) en ${configuredTestDirs().join(', ')}\n`);
    for (const row of rows) {
      const ratio = row.covered / row.total;
      const percent = String(Math.round(ratio * 100)).padStart(3);
      const marker = row.scoped ? '' : '  (sin tests que nombren el contrato)';
      console.log(
        `  ${row.id.padEnd(11)} ${coverageBar(ratio)} ${percent}%  ${String(row.covered).padStart(3)}/${String(row.total).padEnd(3)}` +
        `  BR ${row.brCovered}/${row.brTotal} · AC ${row.acCovered}/${row.acTotal}${marker}`
      );
    }

    const percent = payload.summary.coverage;
    console.log(`\nResumen: ${totalCovered}/${totalCriteria} criterios cubiertos (${percent}%) · ${payload.summary.orphans} huérfanos · ${payload.summary.unscoped} contrato(s) sin tests propios`);

    if (orphanCriteria.length > 0) {
      const shown = orphanCriteria.slice(0, 12);
      console.log(`\nHuérfanos: ${shown.join(', ')}${orphanCriteria.length > shown.length ? ` … y ${orphanCriteria.length - shown.length} más` : ''}`);
    }

    console.log('\nUn criterio cuenta como cubierto solo si un test que nombra el contrato lo cita en su título.');
  }

  return payload.summary.orphans === 0 ? 0 : 1;
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
  approve: commandApprove,
  sync: commandSync,
  loop: commandLoop,
  graph: commandGraph,
  split: commandSplit,
  reconcile: commandReconcile,
  review: commandReview,
  init: commandInit,
  doctor: commandDoctor,
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

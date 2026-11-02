#!/usr/bin/env node

/**
 * SDD-GL Model Context Protocol (MCP) Server
 * Exposes Spec-Driven Development tools via standard JSON-RPC stdio protocol.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.env.SDD_PROJECT_ROOT || process.cwd();
const CONTRACTS_DIR = path.join(PROJECT_ROOT, 'contracts');
const SDD_DIR = path.join(PROJECT_ROOT, '.sdd');
const SDD_RUNS_DIR = path.join(SDD_DIR, 'runs');
const METRICS_FILE = path.join(SDD_DIR, 'metrics.json');
const USAGE_FILE = path.join(SDD_DIR, 'usage.json');

// Telemetry can be disabled with SDD_TELEMETRY=off (used by read-only CLI commands).
const TELEMETRY_ENABLED = process.env.SDD_TELEMETRY !== 'off';

// Read-only tools must NEVER create files in the project (FEAT-0029 BR-004 / AC-005).
// Only the write paths call this.
function ensureWritableDirs() {
  if (!fs.existsSync(CONTRACTS_DIR)) fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  if (!fs.existsSync(SDD_RUNS_DIR)) fs.mkdirSync(SDD_RUNS_DIR, { recursive: true });
  if (!fs.existsSync(SDD_DIR)) fs.mkdirSync(SDD_DIR, { recursive: true });
}

function stateDirExists() {
  return fs.existsSync(SDD_DIR);
}

// Pure helper: computes the next correlational contract ID from a list of file names.
// Only files matching "<TYPE>-<number>.md" are parsed. Numbers >= 9000 are excluded
// (reserved range for validation/sandbox contracts, e.g. FEAT-9999).
// Next ID = max(correlational numbers) + 1, or the first ID when none exist (BR-001).
function computeNextContractId(files, type) {
  const pattern = new RegExp(`^${type}-(\\d+)\\.md$`);
  const numbers = files
    .map(file => {
      const match = file.match(pattern);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter(n => n !== null && n < 9000);
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `${type}-${String(next).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Loop step verification (FEAT-0015)
// The step outcome is never fabricated: it is either reported by the agent that
// actually ran the work (FEAT-0007 Main Flow step 3) or produced by executing
// the layer's verification command and reading its real exit code (BR-003).
// ---------------------------------------------------------------------------

const RESULT_VALUES = ['PASS', 'FAIL', 'BLOCKED', 'NOT_WRITABLE'];
const RESULT_TO_STATUS = { PASS: '✅', FAIL: '❌', BLOCKED: '❌', NOT_WRITABLE: '❌' };

// Default verification command per layer. Override with SDD_LOOP_CMD_<LAYER>.
const DEFAULT_LAYER_COMMANDS = {
  functional: 'npm test',
  static: 'node test-sandbox/multilayer-verifier.test.js',
  security: 'node test-sandbox/multilayer-verifier.test.js',
  arch: 'node test-sandbox/multilayer-verifier.test.js'
};

function normalizeReportedResult(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (RESULT_VALUES.includes(normalized)) return normalized;
  return { invalid: String(value) };
}

function resolveLayerCommand(layer) {
  const envKey = `SDD_LOOP_CMD_${String(layer).toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey];
  return DEFAULT_LAYER_COMMANDS[layer] || null;
}

function tailOutput(value, limit = 1500) {
  const text = String(value || '').trim();
  return text.length > limit ? `...${text.slice(-limit)}` : text;
}

// ---------------------------------------------------------------------------
// Quality metrics ledger (FEAT-0016)
// `.sdd/metrics.json` is the single source of truth for quality metrics (BR-001):
// FPQR, average retries, per-layer success rates and ambiguity escalation rate.
// ---------------------------------------------------------------------------

const METRICS_SCHEMA_VERSION = 1;
const DEFAULT_LAYERS = ['functional', 'static', 'security', 'arch'];
const CONFIG_FILE = path.join(SDD_DIR, 'config.json');

// Verification layers are configurable per project (`.sdd/config.json`).
// The default keeps the four standard layers.
function getLayerNames() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (Array.isArray(config.layers) && config.layers.length > 0) {
      return config.layers.map(String);
    }
  } catch (error) {
    // No config (or unreadable): fall back to the defaults.
  }
  return DEFAULT_LAYERS;
}

const LAYERS = getLayerNames();

function defaultMetrics() {
  const layerSuccessRates = {};
  const perLayer = {};
  for (const layer of LAYERS) {
    layerSuccessRates[layer] = 0;
    perLayer[layer] = { steps: 0, pass: 0, fail: 0 };
  }

  return {
    schema_version: METRICS_SCHEMA_VERSION,
    last_updated: null,
    first_pass_quality_rate: 0,
    average_retries: 0,
    layer_success_rates: layerSuccessRates,
    ambiguity_escalation_rate: 0,
    counters: {
      steps_total: 0,
      steps_pass: 0,
      steps_fail: 0,
      steps_blocked: 0,
      retries_total: 0,
      ambiguities_escalated: 0,
      contracts_resolved: 0
    },
    per_layer: perLayer
  };
}

function mergeMetrics(parsed) {
  const base = defaultMetrics();
  return {
    ...base,
    ...parsed,
    layer_success_rates: { ...base.layer_success_rates, ...(parsed.layer_success_rates || {}) },
    counters: { ...base.counters, ...(parsed.counters || {}) },
    per_layer: { ...base.per_layer, ...(parsed.per_layer || {}) }
  };
}

// Reads the ledger. Only counter/rate data is stored: no PII, no secrets (BR-004).
function readMetrics() {
  if (!fs.existsSync(METRICS_FILE)) {
    return { metrics: defaultMetrics(), source: 'defaults', warning: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== METRICS_SCHEMA_VERSION) {
      return {
        metrics: defaultMetrics(),
        source: 'defaults',
        warning: 'metrics.json has an unexpected schema; falling back to defaults.'
      };
    }
    return { metrics: mergeMetrics(parsed), source: 'file', warning: null };
  } catch (e) {
    return {
      metrics: defaultMetrics(),
      source: 'defaults',
      warning: `metrics.json is unreadable (${e.message}); falling back to defaults.`
    };
  }
}

function recomputeDerivedMetrics(metrics) {
  const ratio = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
  const counters = metrics.counters;

  metrics.first_pass_quality_rate = ratio(counters.steps_pass, counters.steps_total);
  metrics.average_retries = counters.contracts_resolved > 0
    ? Math.round((counters.retries_total / counters.contracts_resolved) * 100) / 100
    : 0;
  metrics.ambiguity_escalation_rate = ratio(counters.ambiguities_escalated, counters.steps_total);

  for (const layer of LAYERS) {
    const bucket = metrics.per_layer[layer] || { steps: 0, pass: 0, fail: 0 };
    metrics.layer_success_rates[layer] = ratio(bucket.pass, bucket.steps);
  }

  metrics.last_updated = new Date().toISOString();
  return metrics;
}

// BR-003: atomic write (temp file + rename) so a crash never leaves a half file.
function writeMetricsAtomic(metrics) {
  const dir = path.dirname(METRICS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${METRICS_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, METRICS_FILE);
}

function recordStepOutcome(layer, itemStatus, contractJustResolved) {
  const { metrics } = readMetrics();
  const bucket = metrics.per_layer[layer] || { steps: 0, pass: 0, fail: 0 };

  metrics.counters.steps_total += 1;
  bucket.steps += 1;

  if (itemStatus === 'PASS') {
    metrics.counters.steps_pass += 1;
    bucket.pass += 1;
  } else if (itemStatus === 'FAIL') {
    metrics.counters.steps_fail += 1;
    bucket.fail += 1;
  } else {
    metrics.counters.steps_blocked += 1;
  }

  metrics.per_layer[layer] = bucket;
  if (contractJustResolved) metrics.counters.contracts_resolved += 1;

  writeMetricsAtomic(recomputeDerivedMetrics(metrics));
}

function isContractFullyComplete(text) {
  const match = text.match(/## Completion Map\n([\s\S]*?)(?:\n## |\n*$)/);
  if (!match) return false;
  const lines = match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('# ') && l.includes('|'));
  if (lines.length < 2) return false;
  const items = lines.slice(1);
  return items.length > 0 && items.every(line => line.endsWith('✅'));
}

// ---------------------------------------------------------------------------
// Contract parsing helpers (FEAT-0007: the server is a deterministic ledger)
//
// The format is neutral: sections can be written in English or Spanish and the
// contract type comes from front-matter, the ID or the file name — never from a
// single hardcoded convention (see the FIX with a `## Pasos` heading).
// ---------------------------------------------------------------------------

const SECTION_KEYS = {
  userStory: ['User Story', 'Historia de Usuario'],
  intent: ['Intent', 'Intencion', 'Intención'],
  useCase: ['Use Case', 'Caso de Uso'],
  flow: [
    'Main Flow',
    'Flujo Principal',
    'Reproduction Steps',
    'Pasos de Reproduccion',
    'Pasos de Reproducción',
    'Pasos'
  ],
  alternativeFlows: ['Alternative Flows', 'Flujos Alternativos', 'Flujos alternativos'],
  businessRules: ['Business Rules', 'Reglas de Negocio', 'Reglas de negocio'],
  acceptanceCriteria: ['Acceptance Criteria', 'Criterios de Aceptacion', 'Criterios de Aceptación'],
  entities: ['Entities Affected', 'Entidades Afectadas', 'Entidades afectadas'],
  inferredAssumptions: ['Inferred Assumptions', 'Supuestos Inferidos', 'Supuestos inferidos'],
  ambiguityLog: ['Ambiguity Log', 'Registro de Ambiguedades', 'Registro de Ambigüedades'],
  completionMap: ['Completion Map', 'Mapa de Completitud'],
  definitionOfDone: ['Definition of Done', 'Definicion de Terminado', 'Definición de Terminado']
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Accepts a section key (aliases resolved) or a literal heading.
function extractSection(text, keyOrHeading) {
  const candidates = SECTION_KEYS[keyOrHeading] || [keyOrHeading];
  for (const heading of candidates) {
    const pattern = new RegExp(`##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

// Counts numbered steps written either as a list (`1. …`) or as a heading
// (`### 1. …`), both common in real contracts.
function countNumberedSteps(section) {
  return (section.match(/^\s*(?:#{2,4}\s*)?\d+\.\s+\S/gm) || []).length;
}

function collectIds(text, prefix) {
  const matches = text.match(new RegExp(`\\b${prefix}-\\d+\\b`, 'g')) || [];
  return [...new Set(matches)];
}

function collectSectionIds(text, sectionKey, prefix) {
  const section = extractSection(text, sectionKey);
  return collectIds(section, prefix);
}

// Parses an optional YAML front-matter block (`--- key: value ---`).
function parseFrontMatter(text) {
  const match = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (pair) meta[pair[1].toLowerCase()] = pair[2].trim();
  }
  return meta;
}

// Type resolution order: front-matter -> ID/file prefix -> feature.
function inferContractType(contractId, text, fileName) {
  const meta = parseFrontMatter(text);
  if (meta.type) return String(meta.type).toLowerCase();

  const haystack = `${contractId || ''} ${fileName || ''}`.toUpperCase();
  if (/(^|[^A-Z])FIX-\d+/.test(haystack)) return 'fix';
  if (/(^|[^A-Z])FEAT-\d+/.test(haystack)) return 'feature';
  return 'feature';
}

function listContractFiles() {
  if (!fs.existsSync(CONTRACTS_DIR)) return [];
  return fs
    .readdirSync(CONTRACTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => entry.name);
}

// Finds a contract by ID regardless of the file naming convention
// (`FIX-0001.md`, `02-FIX-0002-sdd-gl-ci-verde.md`, etc.).
function resolveContractFile(contractId) {
  if (!contractId) return null;

  const files = listContractFiles();
  const exact = `${contractId}.md`;
  if (files.includes(exact)) return path.join(CONTRACTS_DIR, exact);

  const byName = files.find(name => name.endsWith(`-${contractId}.md`) || name.startsWith(`${contractId}-`));
  if (byName) return path.join(CONTRACTS_DIR, byName);

  const idPattern = new RegExp(`^#\\s*ID:\\s*${escapeRegExp(contractId)}\\s*$`, 'm');
  for (const name of files) {
    const fullPath = path.join(CONTRACTS_DIR, name);
    const head = fs.readFileSync(fullPath, 'utf8').slice(0, 600);
    if (idPattern.test(head)) return fullPath;
  }

  return null;
}

function extractCriterionText(text, itemId) {
  const pattern = new RegExp(`^\\s*(?:-|\\d+\\.)\\s*${escapeRegExp(itemId)}:?\\s*(.*)$`, 'm');
  const match = text.match(pattern);
  return match ? `${itemId}: ${match[1].trim()}` : null;
}

// Builds the Completion Map from the inference table in protocol/contract.md.
function buildCompletionMap(text, contractId) {
  const lines = ['# [item-id]|[layer]|[test-id]|[agente]|[status]'];

  const flowSteps = countNumberedSteps(extractSection(text, 'flow'));
  if (flowSteps > 0) {
    const testIdByLayer = {
      functional: `functional-tests:${contractId}-main`,
      static: `static-analysis:${contractId}-main`,
      security: `security-scan:${contractId}-main`,
      arch: `arch-guard:${contractId}-main`
    };
    for (const layer of LAYERS) {
      lines.push(`# Main Flow | ${layer} | ${testIdByLayer[layer]} | ${layer === 'functional' ? 'tester' : 'verifier'} | ❌`);
    }
  }

  for (const af of collectSectionIds(text, 'alternativeFlows', 'AF')) {
    lines.push(`# ${af} | functional | unit-test:${contractId}-${af.toLowerCase().replace('-', '')} | tester | ❌`);
  }
  for (const br of collectSectionIds(text, 'businessRules', 'BR')) {
    lines.push(`# ${br} | functional | unit-test:${contractId}-${br.toLowerCase().replace('-', '')} | tester | ❌`);
  }
  for (const ac of collectSectionIds(text, 'acceptanceCriteria', 'AC')) {
    lines.push(`# ${ac} | functional | assertion:${contractId}-${ac.toLowerCase().replace('-', '')} | tester | ❌`);
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// Heuristic BR <-> AC contradiction detection (BR-003).
function detectContradictions(text) {
  // Mirrors "field <op> number" on both sides; only the identifier adjacent to the
  // operator counts, so prose like "acepta monto = 0" still yields the field "monto".
  const constraint = /([A-Za-z_][\w.]*)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)/;
  const brs = [...text.matchAll(/^\s*-\s*(BR-\d+):?\s*(.*)$/gm)].map(m => ({ id: m[1], body: m[2] }));
  const acs = [...text.matchAll(/^\s*-\s*(AC-\d+):?\s*(.*)$/gm)].map(m => ({ id: m[1], body: m[2] }));
  const contradictions = [];

  for (const br of brs) {
    const rule = br.body.match(constraint);
    if (!rule) continue;
    const field = rule[1].trim().toLowerCase();
    const operator = rule[2];
    const value = Number(rule[3]);

    for (const ac of acs) {
      const assertion = ac.body.match(constraint);
      if (!assertion) continue;
      if (assertion[1].trim().toLowerCase() !== field) continue;

      const acOperator = assertion[2];
      const acValue = Number(assertion[3]);
      if (acOperator !== '=') continue;

      const satisfied = operator === '>' ? acValue > value
        : operator === '>=' ? acValue >= value
          : operator === '<' ? acValue < value
            : operator === '<=' ? acValue <= value
              : acValue === value;

      if (!satisfied) {
        contradictions.push({
          br: br.id,
          ac: ac.id,
          field,
          reason: `${br.id} requires ${field} ${operator} ${value} but ${ac.id} accepts ${field} = ${acValue}`
        });
      }
    }
  }

  return contradictions;
}

// Atomicity: a contract must declare ONE user story with ONE goal, and stay
// within a budget calibrated on the real corpus (max 9 BR / 8 AC historically).
const ATOMICITY_BUDGET = { businessRules: 7, acceptanceCriteria: 8, alternativeFlows: 5, steps: 9 };

// Template markers left behind by `sdd create_contract` or `sdd split`.
const PLACEHOLDER_MARKERS = [
  '[completar',
  '[quién]',
  '[quien]',
  '[un solo objetivo]',
  '[beneficio esperado]',
  '[condition]',
  '[result]',
  '[Verifiable invariant]',
  '[context]',
  '[action]',
  '[expected result]',
  '[Entity]',
  '[relevant attributes]',
  '[entidad]',
  '[invariante verificable]',
  '[contexto]',
  '[resultado esperado]',
  '[condición]',
  '[condicion]'
];

// Reports a multi-goal story only when two infinitives are joined by a connector
// ("crear y aprobar"), which keeps the false-positive rate low in Spanish.
function detectMultiGoal(storySection) {
  const quiero = storySection.match(/^\s*[-*]?\s*(?:Quiero|I want)\s*:?\s*(.+)$/im);
  if (!quiero) return null;

  const line = quiero[1].trim();
  const joined = line.match(/\b\w+(?:ar|er|ir)\b\s*(?:,|\by\b|\be\b|\band\b)\s*\w+(?:ar|er|ir)\b/i);
  return joined ? { line, fragment: joined[0] } : null;
}

function hasWaiver(ambiguitySection, code) {
  const pattern = new RegExp(`^\\s*-\\s*\\[x\\]\\s*${code}\\s*:\\s*\\S`, 'im');
  return pattern.test(ambiguitySection);
}

// Structural checklist per contract type (BR-002).
// The flow section is resolved through aliases, so `## Pasos`, `## Main Flow` and
// `## Reproduction Steps` are all valid for the same rule.
function validateGateStructure(text, contractId, fileName) {
  const type = inferContractType(contractId, text, fileName);
  const isFix = type === 'fix';
  const issues = [];

  const steps = countNumberedSteps(extractSection(text, 'flow'));
  if (steps < 3) issues.push(`Flow section must have at least 3 numbered steps (found ${steps}).`);

  if (!isFix && collectSectionIds(text, 'alternativeFlows', 'AF').length < 1) {
    issues.push('Alternative Flows must declare at least 1 AF-XX or state "ninguno".');
  }
  if (!isFix && collectSectionIds(text, 'businessRules', 'BR').length < 1) {
    issues.push('Business Rules must declare at least 1 BR-XXX.');
  }
  if (collectSectionIds(text, 'acceptanceCriteria', 'AC').length < 1) {
    issues.push('Acceptance Criteria must declare at least 1 AC-XXX.');
  }

  const ambiguity = extractSection(text, 'ambiguityLog');
  if ((ambiguity.match(/^\s*-\s*\[ \]/gm) || []).length > 0) {
    issues.push('Ambiguity Log has unresolved items (- [ ]).');
  }

  const assumptions = extractSection(text, 'inferredAssumptions');
  if (assumptions && (assumptions.match(/^\s*-\s*\[ \]/gm) || []).length > 0) {
    issues.push('Inferred Assumptions has open items (- [ ]).');
  }

  // Atomicity checks apply while the contract is still in Gate, so already
  // approved/resolved contracts are never retroactively invalidated.
  const isDraft = /^#\s*Status:\s*DRAFT\s*$/m.test(text);

  if (isDraft) {
    const placeholders = PLACEHOLDER_MARKERS.filter(marker => text.includes(marker));
    if (placeholders.length > 0) {
      const shown = placeholders.slice(0, 3).join(', ');
      issues.push(`PLACEHOLDER: the contract still contains template text (${shown}${placeholders.length > 3 ? ', …' : ''}).`);
    }

    const story = extractSection(text, 'userStory');
    if (!story) {
      if (!hasWaiver(ambiguity, 'STORY-OK')) {
        issues.push('STORY_MISSING: a User Story (Como / Quiero / Para) is required before approval.');
      }
    } else if (!isFix && !hasWaiver(ambiguity, 'STORY-OK')) {
      const multiGoal = detectMultiGoal(story);
      if (multiGoal) {
        issues.push(`STORY_MULTI_GOAL: "${multiGoal.fragment}" declares more than one goal.`);
      }
    }

    if (!hasWaiver(ambiguity, 'BUDGET-OK')) {
      const brCount = collectSectionIds(text, 'businessRules', 'BR').length;
      const acCount = collectSectionIds(text, 'acceptanceCriteria', 'AC').length;
      const afCount = collectSectionIds(text, 'alternativeFlows', 'AF').length;
      const over = [];

      if (brCount > ATOMICITY_BUDGET.businessRules) over.push(`${brCount} BR (max ${ATOMICITY_BUDGET.businessRules})`);
      if (acCount > ATOMICITY_BUDGET.acceptanceCriteria) over.push(`${acCount} AC (max ${ATOMICITY_BUDGET.acceptanceCriteria})`);
      if (afCount > ATOMICITY_BUDGET.alternativeFlows) over.push(`${afCount} AF (max ${ATOMICITY_BUDGET.alternativeFlows})`);
      if (steps > ATOMICITY_BUDGET.steps) over.push(`${steps} steps (max ${ATOMICITY_BUDGET.steps})`);

      if (over.length > 0) {
        issues.push(`BUDGET_EXCEEDED: ${over.join(', ')} — split the contract or record a BUDGET-OK waiver.`);
      }
    }
  }

  return { type, isFix, issues };
}

// ---------------------------------------------------------------------------
// Local usage telemetry (FEAT-0008)
// Counts real tool invocations in `.sdd/usage.json`. 100% local: no network, no
// global aggregation. Never stores arguments, file paths, contract content or PII
// (BR-006, BR-007).
// ---------------------------------------------------------------------------

const USAGE_SCHEMA_VERSION = 1;
const MAX_TRACKED_CLIENTS = 50;
const MAX_SESSIONS = 50;
let telemetryWarning = null;

function defaultUsage() {
  return {
    schema_version: USAGE_SCHEMA_VERSION,
    first_seen: null,
    last_updated: null,
    sessions: 0,
    session_log: [],
    clients: {},
    sources: { mcp: 0, cli: 0 },
    by_type: { feature: 0, fix: 0, unknown: 0 },
    cli_commands: {},
    tools: {},
    totals: { calls: 0, errors: 0 }
  };
}

function readUsage() {
  if (!fs.existsSync(USAGE_FILE)) {
    return { usage: defaultUsage(), source: 'defaults' };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (!parsed || parsed.schema_version !== USAGE_SCHEMA_VERSION) {
      return { usage: defaultUsage(), source: 'defaults' };
    }
    const base = defaultUsage();
    return {
      usage: {
        ...base,
        ...parsed,
        tools: { ...(parsed.tools || {}) },
        clients: { ...(parsed.clients || {}) },
        totals: { ...base.totals, ...(parsed.totals || {}) }
      },
      source: 'file'
    };
  } catch (error) {
    return { usage: defaultUsage(), source: 'defaults', warning: `usage.json unreadable (${error.message})` };
  }
}

function writeUsageAtomic(usage) {
  const dir = path.dirname(USAGE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${USAGE_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(usage, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, USAGE_FILE);
}

function recordToolCall(toolName, succeeded, meta = {}) {
  const { usage } = readUsage();
  const now = new Date().toISOString();

  usage.first_seen = usage.first_seen || now;
  usage.last_updated = now;
  usage.totals.calls += 1;
  if (!succeeded) usage.totals.errors += 1;
  usage.tools[toolName] = (usage.tools[toolName] || 0) + 1;

  // Origin: MCP client traffic vs the CLI (both are real usage of the methodology).
  const source = meta.source === 'cli' ? 'cli' : 'mcp';
  if (!usage.sources) usage.sources = { mcp: 0, cli: 0 };
  usage.sources[source] = (usage.sources[source] || 0) + 1;

  // Work type: which contracts this invocation was serving.
  const type = meta.type === 'fix' ? 'fix' : meta.type === 'feature' ? 'feature' : null;
  if (!usage.by_type) usage.by_type = { feature: 0, fix: 0, unknown: 0 };
  usage.by_type[type || 'unknown'] = (usage.by_type[type || 'unknown'] || 0) + 1;

  // CLI command breakdown (status/validate/next/report/new).
  if (meta.command) {
    if (!usage.cli_commands) usage.cli_commands = {};
    usage.cli_commands[meta.command] = (usage.cli_commands[meta.command] || 0) + 1;
  }

  // Attribute the call to the most recent session. Sessions belong to MCP clients;
  // CLI invocations are counted in `sources.cli` but do not inflate a session.
  if (source === 'mcp' && Array.isArray(usage.session_log) && usage.session_log.length > 0) {
    const session = usage.session_log[usage.session_log.length - 1];
    session.calls = (session.calls || 0) + 1;
    session.last_call_at = now;
  }

  writeUsageAtomic(usage);
}

function recordDeclaredClient(clientInfo) {
  const { usage } = readUsage();
  const now = new Date().toISOString();
  const name = clientInfo && clientInfo.name ? String(clientInfo.name).slice(0, 80) : null;
  const version = clientInfo && clientInfo.version ? String(clientInfo.version).slice(0, 40) : null;

  usage.first_seen = usage.first_seen || now;
  usage.last_updated = now;
  usage.sessions += 1;

  const key = name ? `${name}${version ? `@${version}` : ''}` : 'cliente no declarado';
  const tracked = Object.keys(usage.clients).length;
  if (tracked < MAX_TRACKED_CLIENTS || usage.clients[key] !== undefined) {
    usage.clients[key] = (usage.clients[key] || 0) + 1;
  }

  // Bounded session history: dates, client and call counts only (no PII).
  if (!Array.isArray(usage.session_log)) usage.session_log = [];
  usage.session_log.push({ started_at: now, client: key, calls: 0, last_call_at: now });
  if (usage.session_log.length > MAX_SESSIONS) {
    usage.session_log = usage.session_log.slice(-MAX_SESSIONS);
  }

  writeUsageAtomic(usage);
}

// ---------------------------------------------------------------------------
// Structured run events (append-only NDJSON)
// The markdown `.log` files are for humans; this ledger is for tools (report,
// dashboards, future graph views). One JSON object per line, never rewritten.
// ---------------------------------------------------------------------------

function appendRunEvent(contractId, event) {
  try {
    const dir = path.join(SDD_RUNS_DIR, contractId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'events.ndjson'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    telemetryWarning = `run events: ${error.message}`;
  }
}

// Tool definitions for MCP tools/list
const TOOLS = [
  {
    name: 'sdd_create_contract',
    description: 'Creates a new SDD-GL specification contract in DRAFT mode.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title or short summary of the work item' },
        type: { type: 'string', enum: ['FEAT', 'FIX'], description: 'Contract type' },
        gate_mode: { type: 'string', enum: ['EXPRESS', 'STRICT'], description: 'Gate governance profile' },
        intent: { type: 'string', description: 'Problem statement and expected outcome' }
      },
      required: ['title', 'type']
    }
  },
  {
    name: 'sdd_validate_gate',
    description: 'Validates structural completeness and checks internal consistency of a contract in DRAFT mode.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_id: { type: 'string', description: 'Contract ID (e.g. FEAT-0001 or FIX-0001)' }
      },
      required: ['contract_id']
    }
  },
  {
    name: 'sdd_step_loop',
    description: 'Executes a deterministic step in the Loop phase and records a Glass Box audit entry.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_id: { type: 'string', description: 'Target contract ID in APPROVED status' },
        item_id: { type: 'string', description: 'Specific criterion/layer ID or "auto" for next item' },
        layer: {
          type: 'string',
          enum: ['functional', 'static', 'security', 'arch'],
          description: 'Disambiguates rows that share a name across layers (e.g. the four "Main Flow" rows).'
        },
        result: {
          type: 'string',
          enum: ['PASS', 'FAIL', 'BLOCKED', 'NOT_WRITABLE'],
          description: 'Outcome the agent obtained for this item. When omitted, the item is claimed (⏳) and its context returned.'
        },
        evidence: { type: 'string', description: 'Test/runner output backing the reported result' },
        verify: {
          type: 'boolean',
          description: 'Legacy explicit path: run the layer verification command instead of claiming the item.'
        }
      },
      required: ['contract_id']
    }
  },
  {
    name: 'sdd_log_ambiguity',
    description: 'Records an unresolved blocker in the Ambiguity Log and transitions contract back to DRAFT/GATE.',
    inputSchema: {
      type: 'object',
      properties: {
        contract_id: { type: 'string', description: 'Contract ID' },
        item_id: { type: 'string', description: 'Criterion ID that failed' },
        reason: { type: 'string', description: 'Precise description of the ambiguity or missing design decision' }
      },
      required: ['contract_id', 'item_id', 'reason']
    }
  },
  {
    name: 'sdd_get_status',
    description: 'Returns the consolidated dashboard status of all contracts in the project.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sdd_get_metrics',
    description: 'Returns First-Pass Quality Rates (FPQR), retry averages, and layer success rates.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sdd_audit_traceability',
    description: 'Audits traceability between contracts and active codebase (orphan specs vs untracked code).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'sdd_generate_dashboard',
    description: 'Compiles project telemetry and generates the Living Visual Dashboard in docs/index.html.',
    inputSchema: { type: 'object', properties: {} }
  }
];

// Tool handlers
// Every invocation is counted locally (FEAT-0008). Telemetry is best-effort: a broken
// ledger must never fail a tool call, but the failure is captured instead of swallowed.
function handleToolCall(name, args, meta = {}) {
  const result = dispatchToolCall(name, args);

  // Telemetry never creates project state: in an uninitialized project a read-only
  // call leaves the directory untouched, and SDD_TELEMETRY=off disables it entirely.
  try {
    if (TELEMETRY_ENABLED && stateDirExists()) {
      recordToolCall(name, !(result && result.error), meta);
    }
  } catch (error) {
    telemetryWarning = error.message;
  }

  return result;
}

function dispatchToolCall(name, args) {
  switch (name) {
    case 'sdd_create_contract': {
      ensureWritableDirs();
      const type = args.type.toUpperCase();
      const files = fs.readdirSync(CONTRACTS_DIR);
      const id = computeNextContractId(files, type);
      const gateMode = args.gate_mode || (type === 'FIX' ? 'EXPRESS' : 'STRICT');
      const filepath = path.join(CONTRACTS_DIR, `${id}.md`);

      // Never overwrite an existing contract file (BR-002)
      if (fs.existsSync(filepath)) {
        return { error: `Contract ${id} already exists. Aborting to avoid overwrite.` };
      }

      const content = `# CONTRACT: ${args.title}
# ID: ${id}
# Status: DRAFT
# Mode: GATE
# Gate-Mode: ${gateMode}

## Intent
${args.intent || '[Inferred from user description]'}

## User Story
- Como: [quién]
- Quiero: [un solo objetivo]
- Para: [beneficio esperado]

## Use Case
**Actor:** Developer
**Goal:** ${args.title}

### Main Flow
1. Step 1
2. Step 2
3. Step 3

### Alternative Flows
- AF-01: [condition] -> [result]

## Business Rules
- BR-001: [Verifiable invariant]

## Acceptance Criteria
- AC-001: GIVEN [context] WHEN [action] THEN [expected result]

## Entities Affected
- [Entity]: [relevant attributes]

## Inferred Assumptions
- [x] Ninguno

## Ambiguity Log
- [x] Ninguno

## Completion Map
# (generado por el Loop al transicionar a Mode: LOOP)
`;
      fs.writeFileSync(filepath, content, 'utf8');
      return { success: true, contract_id: id, path: filepath, gate_mode: gateMode };
    }

    case 'sdd_validate_gate': {
      const filepath = resolveContractFile(args.contract_id);
      if (!filepath) {
        return { error: `Contract ${args.contract_id} not found.` };
      }
      const text = fs.readFileSync(filepath, 'utf8');
      const isDraft = /^# Status:\s*DRAFT\s*$/m.test(text);
      const { type, isFix, issues } = validateGateStructure(text, args.contract_id, path.basename(filepath));
      const contradictions = detectContradictions(text);

      // AF-02 wins over AF-01: a contradiction is reported even when the shape is incomplete.
      const status = contradictions.length > 0
        ? 'CONTRADICTION_DETECTED'
        : issues.length === 0 ? 'READY_FOR_APPROVAL' : 'INCOMPLETE';

      return {
        contract_id: args.contract_id,
        contract_file: path.basename(filepath),
        status,
        type,
        is_draft: isDraft,
        is_fix: isFix,
        missing: issues,
        blocking_issues: issues,
        contradictions
      };
    }

    case 'sdd_step_loop': {
      const filepath = resolveContractFile(args.contract_id);
      if (!filepath) return { error: `Contract ${args.contract_id} not found.` };
      ensureWritableDirs();
      let text = fs.readFileSync(filepath, 'utf8');

      // AF-01: Contract must be APPROVED + LOOP
      if (!text.includes('Status: APPROVED') || !text.includes('Mode: LOOP')) {
        return {
          contract_id: args.contract_id,
          item_status: 'NOT_WRITABLE',
          reason: 'Contract is not in APPROVED / LOOP mode.'
        };
      }

      // Completion Map: reuse it when present, otherwise build and persist it from the
      // inference table in protocol/contract.md (FEAT-0007 Main Flow step 2).
      const readMapLines = (source) => {
        const match = source.match(/## Completion Map\n([\s\S]*?)(?:\n## |\n*$)/);
        if (!match) return [];
        return match[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('# ') && l.includes('|'));
      };

      let mapLines = readMapLines(text);

      if (mapLines.length < 2) {
        const built = buildCompletionMap(text, args.contract_id);
        if (!built) {
          return {
            contract_id: args.contract_id,
            item_status: 'BLOCKED',
            reason: 'No inferable criteria (Main Flow / AF / BR / AC) to build a Completion Map.'
          };
        }

        text = /##\s+Completion Map/.test(text)
          ? text.replace(/##\s+Completion Map\n[\s\S]*$/, `## Completion Map\n${built}\n`)
          : `${text.trimEnd()}\n\n## Completion Map\n${built}\n`;

        fs.writeFileSync(filepath, text, 'utf8');
        mapLines = readMapLines(text);
      }

      // Determine column layout from the header line (first map line).
      // Header formats:
      //   4-col: # [item-id]|[test-id]|[agente]|[status]
      //   5-col: # [item-id]|[layer]|[test-id]|[agente]|[status]
      const headerParts = mapLines[0].split('|').map(p => p.trim());
      const hasLayerColumn = headerParts.length >= 5;

      // Helper: parse a map line into { name, layer, testId, agent, status }
      const parseMapLine = (line) => {
        const p = line.split('|').map(s => s.trim());
        const status = p[p.length - 1];
        let name, testId, layer, agent;
        if (hasLayerColumn) {
          name = p[0].replace('# ', '');
          layer = p[1];
          testId = p[2];
          agent = p[3];
        } else {
          name = p[0].replace('# ', '');
          testId = p[1];
          agent = p[2];
          layer = 'functional';
          if (testId.includes('static')) layer = 'static';
          else if (testId.includes('security')) layer = 'security';
          else if (testId.includes('arch')) layer = 'arch';
        }
        return { name, testId, layer, agent, status, raw: line };
      };

      const parsedLines = mapLines.slice(1).map(parseMapLine);

      // Find target item
      const itemId = args.item_id || 'auto';
      let targetLineIndex = -1;
      let targetLine = '';
      let itemIdFound = '';

      if (itemId === 'auto') {
        // Resume from the first ⏳ (interrupted run), otherwise the first ❌.
        const preferred = parsedLines.findIndex(line => line.status === '⏳') !== -1
          ? '⏳'
          : '❌';
        for (let i = 0; i < parsedLines.length; i++) {
          if (parsedLines[i].status === preferred) {
            targetLineIndex = i;
            targetLine = parsedLines[i].raw;
            itemIdFound = parsedLines[i].name;
            break;
          }
        }
        if (targetLineIndex === -1) {
          return {
            contract_id: args.contract_id,
            item_status: 'BLOCKED',
            reason: 'No pending items (❌/⏳) found in Completion Map.'
          };
        }
      } else {
        // Find a specific item. `layer` disambiguates the four rows that share the
        // "Main Flow" name (functional/static/security/arch).
        const wantedLayer = args.layer ? String(args.layer).trim() : null;
        for (let i = 0; i < parsedLines.length; i++) {
          const candidate = parsedLines[i];
          const nameMatches = candidate.name === itemId;
          const layerMatches = !wantedLayer || candidate.layer === wantedLayer;
          if (nameMatches && layerMatches) {
            targetLineIndex = i;
            targetLine = candidate.raw;
            itemIdFound = itemId;
            break;
          }
        }
        if (targetLineIndex === -1) {
          return {
            contract_id: args.contract_id,
            item_status: 'BLOCKED',
            reason: wantedLayer
              ? `Item ${itemId} not found in layer "${wantedLayer}" of the Completion Map.`
              : `Item ${itemId} not found in Completion Map.`
          };
        }
      }

      // Parse the target line
      const parsed = parseMapLine(targetLine);
      const currentStatus = parsed.status;
      const testId = parsed.testId;
      const layer = parsed.layer;

      // BR-005: Idempotency - if already ✅, don't change
      if (currentStatus === '✅') {
        return {
          contract_id: args.contract_id,
          item_id: itemIdFound,
          item_status: 'PASS',
          previous_status: currentStatus,
          new_status: currentStatus,
          reason: 'Item already completed (idempotent).'
        };
      }

      // FEAT-0007 BR-001 / AC-001: claim mode. Without `result` (and without the
      // explicit legacy `verify` flag) the server persists `⏳` and returns the item
      // context; the agent does the work and reports back with result + evidence.
      // The server never executes tests on its own in this path.
      if (!args.result && !args.verify) {
        const claimedText = text.replace(targetLine, targetLine.replace(`| ${currentStatus}`, '| ⏳'));
        if (claimedText !== text) fs.writeFileSync(filepath, claimedText, 'utf8');

        const contractRunsDir = path.join(SDD_RUNS_DIR, args.contract_id);
        if (!fs.existsSync(contractRunsDir)) fs.mkdirSync(contractRunsDir, { recursive: true });
        const claimTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const claimName = String(itemIdFound).replace(/[^A-Za-z0-9._-]+/g, '-');
        const claimLogPath = path.join(contractRunsDir, `${claimName}-${claimTimestamp}.claim.log`);
        fs.writeFileSync(claimLogPath, `# EXECUTION AUDIT: ${args.contract_id}
# Timestamp: ${new Date().toISOString()}
# Item: ${itemIdFound}
# Layer: ${layer}
# Test ID: ${testId}
# Agent: ${parsed.agent}
# Event: CLAIM
# Previous Status: ${currentStatus}
# New Status: ⏳
`, 'utf8');

        appendRunEvent(args.contract_id, {
          ts: new Date().toISOString(),
          contract: args.contract_id,
          item: itemIdFound,
          layer,
          test_id: testId,
          agent: parsed.agent,
          event: 'CLAIM',
          previous_status: currentStatus,
          new_status: '⏳'
        });

        return {
          contract_id: args.contract_id,
          item_id: itemIdFound,
          layer,
          test_id: testId,
          agent: parsed.agent,
          item_status: 'IN_PROGRESS',
          previous_status: currentStatus,
          new_status: '⏳',
          criterion: extractCriterionText(text, itemIdFound),
          audit_log_path: claimLogPath,
          next_action: 'Execute the criterion, then report back via sdd_step_loop with result (PASS/FAIL/BLOCKED/NOT_WRITABLE) and evidence.'
        };
      }

      // Resolve the real outcome of this step (BR-003). There is deliberately no
      // fallback that writes a PASS without evidence.
      const reported = normalizeReportedResult(args.result);
      if (reported && reported.invalid) {
        return {
          contract_id: args.contract_id,
          item_id: itemIdFound,
          item_status: 'BLOCKED',
          reason: `Invalid result "${reported.invalid}". Expected one of: ${RESULT_VALUES.join(', ')}.`
        };
      }

      let itemStatus;
      let evidence;
      let newStatus;

      if (reported) {
        itemStatus = reported;
        evidence = args.evidence ? String(args.evidence) : 'agent-reported (no evidence supplied)';
        newStatus = RESULT_TO_STATUS[itemStatus];
      } else {
        const command = resolveLayerCommand(layer);
        if (!command) {
          return {
            contract_id: args.contract_id,
            item_id: itemIdFound,
            item_status: 'BLOCKED',
            reason: `No verification command configured for layer "${layer}". Set SDD_LOOP_CMD_${String(layer).toUpperCase()}.`
          };
        }
        if (process.env.SDD_LOOP_ACTIVE === '1') {
          return {
            contract_id: args.contract_id,
            item_id: itemIdFound,
            item_status: 'BLOCKED',
            reason: 'Recursive verification detected (the verification command invoked sdd_step_loop). Report the outcome explicitly with result/evidence.'
          };
        }

        try {
          const output = execSync(command, {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, SDD_LOOP_ACTIVE: '1' }
          });
          itemStatus = 'PASS';
          evidence = `command: ${command}\nexit: 0\n${tailOutput(output)}`;
        } catch (e) {
          itemStatus = 'FAIL';
          evidence = `command: ${command}\nexit: ${e.status === undefined ? 'error' : e.status}\n${tailOutput(e.stdout)}\n${tailOutput(e.stderr)}`;
        }
        newStatus = RESULT_TO_STATUS[itemStatus];
      }

      // BR-002: mutate exactly the target line, and only when the state changes.
      let statusChanged = false;
      if (newStatus !== currentStatus) {
        const updatedText = text.replace(targetLine, targetLine.replace(`| ${currentStatus}`, `| ${newStatus}`));
        fs.writeFileSync(filepath, updatedText, 'utf8');
        statusChanged = true;
      }

      // FEAT-0016 BR-003 / AF-02: the metrics ledger is updated atomically with the
      // step. If it cannot be written, the step is refused and the contract change
      // is rolled back instead of leaving the two records out of sync.
      try {
        const afterText = fs.readFileSync(filepath, 'utf8');
        recordStepOutcome(layer, itemStatus, statusChanged && isContractFullyComplete(afterText));
      } catch (e) {
        if (statusChanged) fs.writeFileSync(filepath, text, 'utf8');
        return {
          contract_id: args.contract_id,
          item_id: itemIdFound,
          item_status: 'BLOCKED',
          reason: `Cannot update .sdd/metrics.json: ${e.message}`
        };
      }

      // BR-004: audit log under .sdd/runs/<contract_id>/ with an identifiable item name.
      const contractRunsDir = path.join(SDD_RUNS_DIR, args.contract_id);
      if (!fs.existsSync(contractRunsDir)) {
        fs.mkdirSync(contractRunsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeItemName = String(itemIdFound).replace(/[^A-Za-z0-9._-]+/g, '-');
      const auditPath = path.join(contractRunsDir, `${safeItemName}-${timestamp}.log`);
      const auditContent = `# EXECUTION AUDIT: ${args.contract_id}
# Timestamp: ${new Date().toISOString()}
# Item: ${itemIdFound}
# Layer: ${layer}
# Test ID: ${testId}
# Agent: ${parsed.agent}
# Previous Status: ${currentStatus}
# New Status: ${newStatus}
# Result: ${itemStatus}
# Evidence:
${evidence}
`;
      fs.writeFileSync(auditPath, auditContent, 'utf8');

      appendRunEvent(args.contract_id, {
        ts: new Date().toISOString(),
        contract: args.contract_id,
        item: itemIdFound,
        layer,
        test_id: testId,
        agent: parsed.agent,
        event: 'RESULT',
        result: itemStatus,
        previous_status: currentStatus,
        new_status: newStatus,
        evidence: String(evidence).slice(0, 500),
        audit_log_path: auditPath
      });

      return {
        contract_id: args.contract_id,
        item_id: itemIdFound,
        item_status: itemStatus,
        layer: layer,
        audit_log_path: auditPath,
        previous_status: currentStatus,
        new_status: newStatus
      };
    }

    case 'sdd_log_ambiguity': {
      const filepath = resolveContractFile(args.contract_id);
      if (!filepath) return { error: `Contract ${args.contract_id} not found.` };
      ensureWritableDirs();
      let text = fs.readFileSync(filepath, 'utf8');

      // BR-004: mark the item ❌ in the Completion Map before escalating.
      let itemMarked = false;
      const mapMatch = text.match(/##\s+Completion Map\n([\s\S]*?)(?=\n##\s|$)/);
      if (mapMatch) {
        const lines = mapMatch[1].split('\n');
        const index = lines.findIndex(line => {
          const trimmed = line.trim();
          return trimmed.startsWith(`# ${args.item_id} |`) || trimmed.startsWith(`# ${args.item_id}|`);
        });

        if (index !== -1) {
          const updatedLine = lines[index].replace(/\|\s*(?:✅|⏳|❌)\s*$/, '| ❌');
          if (updatedLine !== lines[index]) {
            lines[index] = updatedLine;
            text = text.replace(mapMatch[1], lines.join('\n'));
            itemMarked = true;
          } else {
            itemMarked = true; // already ❌
          }
        }
      }

      // Transition back to DRAFT / GATE (header lines only).
      text = text
        .replace(/^# Status:\s*APPROVED\s*$/m, '# Status: DRAFT')
        .replace(/^# Mode:\s*LOOP\s*$/m, '# Mode: GATE');

      // Append the blocker to the Ambiguity Log without destroying existing entries.
      const entry = `- [ ] ${args.item_id}: ${args.reason}`;
      if (/##\s+Ambiguity Log/.test(text)) {
        text = text.replace(/##\s+Ambiguity Log\s*\n/, match => `${match}${entry}\n`);
      } else {
        text = `${text.trimEnd()}\n\n## Ambiguity Log\n${entry}\n`;
      }

      fs.writeFileSync(filepath, text, 'utf8');

      return {
        contract_id: args.contract_id,
        item_id: args.item_id,
        item_marked: itemMarked,
        transitioned_to: 'Status: DRAFT / Mode: GATE',
        ambiguity_logged: args.reason
      };
    }

    case 'sdd_get_status': {
      if (!fs.existsSync(CONTRACTS_DIR)) return { total_contracts: 0, contracts: [] };
      const files = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.md'));

      const summary = files.map(file => {
        const content = fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8');
        const statusMatch = content.match(/^#\s*Status:\s*(DRAFT|APPROVED|RESOLVED)\s*$/m);
        const modeMatch = content.match(/^#\s*Mode:\s*(GATE|LOOP)\s*$/m);
        const idMatch = content.match(/^#\s*ID:\s*(\S+)\s*$/m);
        const titleMatch = content.match(/^#\s*CONTRACT:\s*(.+)$/m);

        // Progress comes from the Completion Map when it exists.
        const mapItems = (content.match(/^#\s+[^|\n]+\|[^\n]*\|\s*(?:✅|⏳|❌)\s*$/gm) || []);
        const done = mapItems.filter(line => line.trim().endsWith('✅')).length;

        return {
          id: idMatch ? idMatch[1] : file.replace(/\.md$/, ''),
          file,
          title: titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, ''),
          type: inferContractType(idMatch ? idMatch[1] : file, content, file),
          status: statusMatch ? statusMatch[1] : 'UNKNOWN',
          mode: modeMatch ? modeMatch[1] : 'UNKNOWN',
          progress: { total: mapItems.length, done }
        };
      });

      return { total_contracts: summary.length, contracts: summary };
    }

    case 'sdd_get_metrics': {
      // BR-001 / BR-002: `.sdd/metrics.json` is the single source of truth.
      // Without the file the response is an explicit zeroed ledger, never invented numbers.
      const { metrics, source, warning } = readMetrics();
      const response = { ...metrics, source };
      if (warning) response.warning = warning;
      if (fs.existsSync(CONTRACTS_DIR)) {
        response.total_contracts = fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.md')).length;
      } else {
        response.total_contracts = 0;
      }
      return response;
    }

    case 'sdd_audit_traceability': {
      // BR-005: real coverage. Nothing here is a fixed value.
      const contractFiles = fs.existsSync(CONTRACTS_DIR)
        ? fs.readdirSync(CONTRACTS_DIR).filter(file => file.endsWith('.md'))
        : [];

      const specs = [];
      let entitiesText = '';

      for (const file of contractFiles) {
        const content = fs.readFileSync(path.join(CONTRACTS_DIR, file), 'utf8');
        const contractId = file.replace('.md', '');
        for (const id of [
          ...collectSectionIds(content, 'Business Rules', 'BR'),
          ...collectSectionIds(content, 'Acceptance Criteria', 'AC')
        ]) {
          specs.push({ id, contract: contractId });
        }
        entitiesText += `\n${extractSection(content, 'Entities Affected')}`;
      }

      const codeFiles = [];
      for (const dir of ['mcp', 'test-sandbox']) {
        const full = path.join(PROJECT_ROOT, dir);
        if (!fs.existsSync(full)) continue;
        for (const name of fs.readdirSync(full)) {
          if (name.endsWith('.js')) codeFiles.push(path.join(dir, name));
        }
      }

      const corpus = codeFiles
        .map(relative => fs.readFileSync(path.join(PROJECT_ROOT, relative), 'utf8'))
        .join('\n');

      const orphan_specs = specs.filter(spec => !new RegExp(`\\b${spec.id}\\b`).test(corpus));
      const covered = specs.length - orphan_specs.length;
      const coverage = specs.length > 0 ? Math.round((covered / specs.length) * 1000) / 10 : 0;

      // Domain files that no contract declares in "Entities Affected".
      const untracked_domain_files = codeFiles.filter(relative => {
        const base = path.basename(relative);
        return !entitiesText.includes(base);
      });

      return {
        total_contracts_inspected: contractFiles.length,
        total_criteria: specs.length,
        covered_criteria: covered,
        specification_coverage_score: coverage,
        orphan_specs: orphan_specs.map(spec => `${spec.contract}:${spec.id}`),
        untracked_domain_files,
        status: orphan_specs.length === 0 ? 'PASSED' : 'GAPS_FOUND'
      };
    }

    case 'sdd_generate_dashboard': {
      try {
        const { generateDashboard } = require('./dashboard-gen');
        const result = generateDashboard();
        return result;
      } catch (e) {
        return { error: `Failed to generate dashboard: ${e.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// JSON-RPC stdio message processor
function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', line => {
    if (!line.trim()) return;
    try {
      const request = JSON.parse(line);
      const { id, method, params } = request;

      if (method === 'initialize') {
        // FEAT-0008: attribute usage to the client only if it declares itself.
        try {
          recordDeclaredClient(params && params.clientInfo);
        } catch (error) {
          telemetryWarning = error.message;
        }

        const response = {
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'sdd-gl-mcp-server',
              version: '0.4.0'
            }
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } else if (method === 'tools/list') {
        const response = {
          jsonrpc: '2.0',
          id: id,
          result: { tools: TOOLS }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } else if (method === 'tools/call') {
        const result = handleToolCall(params.name, params.arguments || {});
        const response = {
          jsonrpc: '2.0',
          id: id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      } else {
        const response = {
          jsonrpc: '2.0',
          id: id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });
}

module.exports = { TOOLS, handleToolCall, computeNextContractId };

if (require.main === module) {
  main();
}

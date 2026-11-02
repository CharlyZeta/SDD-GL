/**
 * CLI — the human-facing interface must work without an MCP client.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Runs against throw-away project roots (non-destructive).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-'));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd || tempRoot,
    env: { ...process.env, SDD_PROJECT_ROOT: options.cwd || tempRoot },
    encoding: 'utf8'
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeContract(name, content) {
  const dir = path.join(tempRoot, 'contracts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

const READY_FIX = `# CONTRACT: Algo roto
# ID: FIX-9401
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Pasos
1. Uno.
2. Dos.
3. Tres.

## Criterios de Aceptación
- AC-001: GIVEN a WHEN b THEN c

## Registro de Ambigüedades
- [x] Ninguna
`;

const INCOMPLETE_FEAT = `# CONTRACT: Algo grande
# ID: FEAT-9402
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Intent
Falta casi todo.

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Main Flow
1. Un solo paso.

## Ambiguity Log
- [ ] Falta decidir el alcance.
`;

before(() => {
  writeContract('FIX-9401.md', READY_FIX);
  writeContract('FEAT-9402.md', INCOMPLETE_FEAT);

  // A resolved contract with a full map and run logs, for the report command.
  writeContract('FEAT-9403.md', `# CONTRACT: Contrato cerrado
# ID: FEAT-9403
# Status: RESOLVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: resolver el caso
- Para: evitar el error

## Main Flow
1. Uno.
2. Dos.
3. Tres.

## Business Rules
- BR-001: invariante

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c

## Ambiguity Log
- [x] Ninguna

## Completion Map
# [item-id]|[layer]|[test-id]|[agente]|[status]
# Main Flow | functional | functional-tests:FEAT-9403-main | tester | ✅
# BR-001 | functional | unit-test:FEAT-9403-br001 | tester | ✅
# AC-001 | functional | assertion:FEAT-9403-ac001 | tester | ✅
`);

  const runsDir = path.join(tempRoot, '.sdd', 'runs', 'FEAT-9403');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, 'BR-001-2026-01-01T00-00-00.log'), `# EXECUTION AUDIT: FEAT-9403
# Timestamp: 2026-01-01T00:00:00.000Z
# Item: BR-001
# Layer: functional
# Event: CLAIM
# Previous Status: ❌
# New Status: ⏳
`, 'utf8');
  fs.writeFileSync(path.join(runsDir, 'BR-001-2026-01-01T00-01-00.log'), `# EXECUTION AUDIT: FEAT-9403
# Timestamp: 2026-01-01T00:01:00.000Z
# Item: BR-001
# Layer: functional
# Previous Status: ⏳
# New Status: ✅
# Result: PASS
`, 'utf8');
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('CLI — protocol and usage', () => {
  test('--help prints the usage and exits 0', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /sdd <comando>/);
  });

  test('an unknown command exits 2 with usage', () => {
    const result = run(['frobnicate']);
    assert.strictEqual(result.code, 2);
    assert.match(result.stderr + result.stdout, /comando desconocido/i);
  });
});

describe('CLI — status', () => {
  test('status --json returns every contract with progress', () => {
    const result = run(['status', '--json']);
    assert.strictEqual(result.code, 0);

    const data = JSON.parse(result.stdout);
    assert.strictEqual(data.total_contracts, 3);

    const resolved = data.contracts.find(contract => contract.id === 'FEAT-9403');
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.deepStrictEqual(resolved.progress, { total: 3, done: 3 });
  });

  test('status on an empty project creates nothing', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-empty-'));
    try {
      const result = run(['status', '--json'], { cwd: emptyRoot });
      assert.strictEqual(result.code, 0);
      assert.deepStrictEqual(JSON.parse(result.stdout).contracts, []);
      assert.deepStrictEqual(fs.readdirSync(emptyRoot), [], 'a read command must not create files');
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('CLI — validate', () => {
  test('a ready contract exits 0', () => {
    const result = run(['validate', 'FIX-9401']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /READY_FOR_APPROVAL/);
  });

  test('an incomplete contract exits 1 and explains why', () => {
    const result = run(['validate', 'FEAT-9402']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /INCOMPLETE/);
    assert.match(result.stdout, /Ambiguity Log/);
  });

  test('a missing contract exits 2', () => {
    const result = run(['validate', 'FEAT-0000']);
    assert.strictEqual(result.code, 2);
  });
});

describe('CLI — new', () => {
  test('new creates a contract and prints its ID', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-new-'));
    try {
      const result = run(['new', 'Notificaciones por email', '--type', 'FEAT'], { cwd: root });
      assert.strictEqual(result.code, 0);
      assert.match(result.stdout, /FEAT-0001/);
      assert.ok(fs.existsSync(path.join(root, 'contracts', 'FEAT-0001.md')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('new without a title exits 2', () => {
    const result = run(['new']);
    assert.strictEqual(result.code, 2);
  });
});

describe('CLI — next', () => {
  test('next suggests validating the pending draft', () => {
    const result = run(['next', '--json']);
    assert.strictEqual(result.code, 0);

    const data = JSON.parse(result.stdout);
    const commands = data.next.map(step => step.command).join(' ');
    assert.match(commands, /validate FEAT-9402|validate FIX-9401/);
  });
});

describe('CLI — report', () => {
  test('report renders the map, the runs and a verdict', () => {
    const result = run(['report', 'FEAT-9403']);
    assert.strictEqual(result.code, 0);

    assert.match(result.stdout, /# Informe de ejecución — FEAT-9403/);
    assert.match(result.stdout, /## Criterios/);
    assert.match(result.stdout, /## Ejecuciones registradas/);
    assert.match(result.stdout, /CLAIM/);
    assert.match(result.stdout, /COMPLETO/);
  });

  test('report --out writes the file instead of stdout', () => {
    const outFile = path.join(tempRoot, 'informe.md');
    const result = run(['report', 'FEAT-9403', '--out', outFile]);

    assert.strictEqual(result.code, 0);
    assert.ok(fs.existsSync(outFile));
    assert.match(fs.readFileSync(outFile, 'utf8'), /# Informe de ejecución — FEAT-9403/);
  });

  test('report of a contract with pending items exits 1', () => {
    const result = run(['report', 'FIX-9401']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /PENDIENTE/);
  });
});

describe('CLI — init and doctor', () => {
  test('init creates the project files and is idempotent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-init-'));
    try {
      const first = run(['init', '--json'], { cwd: root });
      assert.strictEqual(first.code, 0);
      assert.ok(fs.existsSync(path.join(root, '.sdd', 'config.json')));
      assert.ok(fs.existsSync(path.join(root, 'contracts')));
      assert.ok(fs.existsSync(path.join(root, 'CONSTITUTION.md')));

      const second = run(['init', '--json'], { cwd: root });
      const data = JSON.parse(second.stdout);
      assert.deepStrictEqual(data.created, []);
      assert.ok(data.skipped.length >= 3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('init --private writes each ignore line only once', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-private-'));
    try {
      run(['init', '--private'], { cwd: root });
      run(['init', '--private'], { cwd: root });

      const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      assert.strictEqual(gitignore.match(/^contracts\/\*$/gm).length, 1);
      assert.strictEqual(gitignore.match(/^\.sdd\/$/gm).length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('doctor reports no failures on an empty project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-doctor-'));
    try {
      const result = run(['doctor', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(data.ok, true);
      assert.ok(data.checks.some(check => check.name === 'mcp'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('doctor fails on an invalid configuration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-doctor-bad-'));
    try {
      fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
      fs.writeFileSync(path.join(root, '.sdd', 'config.json'), '{ nope', 'utf8');

      const result = run(['doctor', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 1);
      assert.strictEqual(data.ok, false);
      assert.ok(data.checks.some(check => check.name === 'config' && check.status === 'FAIL'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI — usage attribution', () => {
  test('CLI calls are counted and attributed to the contract type', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-usage-'));
    try {
      run(['init'], { cwd: root });
      run(['new', 'Corregir algo', '--type', 'FIX'], { cwd: root });
      run(['validate', 'FIX-0001'], { cwd: root });
      run(['status'], { cwd: root });

      const usage = JSON.parse(fs.readFileSync(path.join(root, '.sdd', 'usage.json'), 'utf8'));

      assert.ok(usage.sources.cli >= 3, 'CLI calls must be counted as CLI');
      assert.ok(usage.by_type.fix >= 2, 'new --type FIX and validate FIX-0001 are attributed to FIX');
      assert.strictEqual(usage.cli_commands.validate, 1);
      assert.strictEqual(usage.cli_commands.status, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI — approve (HO-Gate)', () => {
  function readyProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-approve-'));
    const contractsDir = path.join(root, 'contracts');
    fs.mkdirSync(contractsDir, { recursive: true });
    fs.writeFileSync(path.join(contractsDir, 'FIX-9701.md'), `# CONTRACT: Listo para aprobar
# ID: FIX-9701
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## User Story
- Como: usuario
- Quiero: corregir el redondeo
- Para: cobrar lo mostrado

## Pasos
1. Uno.
2. Dos.
3. Tres.

## Criterios de Aceptación
- AC-001: GIVEN a WHEN b THEN c

## Registro de Ambigüedades
- [x] Ninguna
`, 'utf8');
    return root;
  }

  test('approve refuses without explicit confirmation and does not touch the file', () => {
    const root = readyProject();
    try {
      const before = fs.readFileSync(path.join(root, 'contracts', 'FIX-9701.md'), 'utf8');
      const result = run(['approve', 'FIX-9701'], { cwd: root });

      assert.strictEqual(result.code, 2);
      assert.strictEqual(fs.readFileSync(path.join(root, 'contracts', 'FIX-9701.md'), 'utf8'), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('approve --yes writes the approval fingerprint', () => {
    const root = readyProject();
    try {
      const result = run(['approve', 'FIX-9701', '--yes', '--json'], { cwd: root });
      assert.strictEqual(result.code, 0);

      const data = JSON.parse(result.stdout);
      assert.strictEqual(data.approved, true);
      assert.match(data.hash, /^[0-9a-f]{12}$/);

      const text = fs.readFileSync(path.join(root, 'contracts', 'FIX-9701.md'), 'utf8');
      assert.match(text, /^# Status: APPROVED$/m);
      assert.match(text, /^# Mode: LOOP$/m);
      assert.match(text, /^# Approved-By: .+$/m);
      assert.match(text, /^# Approved-At: .+$/m);
      assert.match(text, new RegExp(`^# Approved-Hash: ${data.hash}$`, 'm'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('approve refuses an incomplete contract', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-approve-bad-'));
    try {
      fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
      fs.writeFileSync(path.join(root, 'contracts', 'FEAT-9702.md'), `# CONTRACT: Incompleto
# ID: FEAT-9702
# Status: DRAFT
# Mode: GATE
# Gate-Mode: STRICT

## Main Flow
1. Un paso.
`, 'utf8');

      const result = run(['approve', 'FEAT-9702', '--yes'], { cwd: root });

      assert.strictEqual(result.code, 1);
      assert.match(fs.readFileSync(path.join(root, 'contracts', 'FEAT-9702.md'), 'utf8'), /^# Status: DRAFT$/m);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI — sync check across platforms', () => {
  function makePair(root) {
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'sdd-coder-agent'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'sdd-coder-agent', 'SKILL.md'), '---\nname: sdd-coder-agent\n---\n', 'utf8');
    fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'coder-agent.md'), '---\nname: coder-agent\n---\n', 'utf8');
  }

  test('a matching pair reports no drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-sync-'));
    try {
      makePair(root);
      const result = run(['sync', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 0);
      assert.strictEqual(data.issues.length, 0);
      assert.strictEqual(data.pairs, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a missing adapter is reported as drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-sync-drift-'));
    try {
      fs.mkdirSync(path.join(root, '.agents', 'skills', 'sdd-tester-agent'), { recursive: true });
      fs.writeFileSync(path.join(root, '.agents', 'skills', 'sdd-tester-agent', 'SKILL.md'), '---\nname: x\n---\n', 'utf8');

      const result = run(['sync', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 1);
      assert.ok(data.issues.some(issue => /tester-agent/.test(issue)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI — loop from the terminal', () => {
  function approvedProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-loop-'));
    run(['init'], { cwd: root });
    run(['new', 'Corregir el redondeo', '--type', 'FIX'], { cwd: root });
    run(['approve', 'FIX-0001', '--yes'], { cwd: root });
    return root;
  }

  function contractText(root) {
    return fs.readFileSync(path.join(root, 'contracts', 'FIX-0001.md'), 'utf8');
  }

  test('loop claims the next item and persists the in-progress marker', () => {
    const root = approvedProject();
    try {
      const result = run(['loop', 'FIX-0001', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 0);
      assert.strictEqual(data.item_status, 'IN_PROGRESS');
      assert.match(contractText(root), /\| ⏳|⏳\s*$/m);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('loop --pass records the result with evidence', () => {
    const root = approvedProject();
    try {
      run(['loop', 'FIX-0001'], { cwd: root });
      const result = run(['loop', 'FIX-0001', '--pass', '--evidence', '27 verdes', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 0);
      assert.strictEqual(data.item_status, 'PASS');
      assert.match(contractText(root), /functional-tests:FIX-0001-main \| tester \| ✅/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('loop --fail returns exit 1', () => {
    const root = approvedProject();
    try {
      run(['loop', 'FIX-0001'], { cwd: root });
      const result = run(['loop', 'FIX-0001', '--fail', '--evidence', 'sigue fallando'], { cwd: root });
      assert.strictEqual(result.code, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CLI — dependency graph', () => {
  function writeGraphProject(root, contracts) {
    fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
    for (const [id, status, dependsOn] of contracts) {
      const front = dependsOn && dependsOn.length > 0 ? `---\ndepends_on: ${dependsOn.join(', ')}\n---\n` : '';
      fs.writeFileSync(path.join(root, 'contracts', `${id}.md`), `${front}# CONTRACT: ${id}
# ID: ${id}
# Status: ${status}
# Mode: GATE
# Gate-Mode: EXPRESS
`, 'utf8');
    }
  }

  test('dependencies come before their dependents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-graph-'));
    try {
      writeGraphProject(root, [
        ['FEAT-9801', 'DRAFT', []],
        ['FEAT-9802', 'DRAFT', ['FEAT-9801']]
      ]);

      const result = run(['graph', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 0);
      assert.deepStrictEqual(data.order, ['FEAT-9801', 'FEAT-9802']);
      assert.deepStrictEqual(data.ready, ['FEAT-9801']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a cycle is reported with exit code 1', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-cycle-'));
    try {
      writeGraphProject(root, [
        ['FEAT-9803', 'DRAFT', ['FEAT-9804']],
        ['FEAT-9804', 'DRAFT', ['FEAT-9803']]
      ]);

      const result = run(['graph', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      assert.strictEqual(result.code, 1);
      assert.deepStrictEqual(data.cyclic.sort(), ['FEAT-9803', 'FEAT-9804']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('next does not suggest a contract whose dependency is pending', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-next-dep-'));
    try {
      writeGraphProject(root, [
        ['FEAT-9805', 'DRAFT', []],
        ['FEAT-9806', 'APPROVED', ['FEAT-9805']]
      ]);

      const result = run(['next', '--json'], { cwd: root });
      const data = JSON.parse(result.stdout);

      const commands = data.next.map(step => step.command).join(' ');
      assert.match(commands, /validate FEAT-9805/);
      assert.ok(!/loop FEAT-9806/.test(commands), 'the dependent contract must not be suggested');
      assert.ok(data.next.some(step => /Esperar FEAT-9806/.test(step.action)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * `contracts/` may hold a README or free-form notes next to the specs.
 * Those files are not contracts and must never break the diagnostics.
 *
 * Reported from a real project: `sdd doctor` failed with "encabezado ilegible"
 * because it parsed `contracts/README.md` as a contract.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');

const CONTRACT = `# CONTRACT: Uno real
# ID: FEAT-0001
# Status: DRAFT
# Mode: GATE
# Gate-Mode: EXPRESS

## User Story
- Como: alguien
- Quiero: algo
- Para: algo

## Use Case
**Actor:** a
**Goal:** b

### Main Flow
1. Uno.
2. Dos.
3. Tres.

### Alternative Flows
- AF-01: x -> y

## Business Rules
- BR-001: algo verificable

## Acceptance Criteria
- AC-001: GIVEN a WHEN b THEN c

## Ambiguity Log
- [x] Ninguno
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-doctor-'));
  fs.mkdirSync(path.join(root, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sdd'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.sdd', 'config.json'),
    JSON.stringify({ schema_version: 1, layers: ['functional', 'static', 'security', 'arch'] }),
    'utf8'
  );
  return root;
}

function run(root, args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: root }
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function withFiles(root, files) {
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'contracts', name), body, 'utf8');
  }
}

describe('contracts/ — non-contract markdown', () => {
  test('a README and free notes never break doctor', () => {
    const root = project();
    try {
      withFiles(root, {
        'FEAT-0001.md': CONTRACT,
        'README.md': '# Contratos\n\nCada archivo `.md` es una spec.\n',
        'notas.md': '# Notas\n\nPendientes varios.\n',
        'TODO.md': '- [ ] escribir más contratos\n'
      });

      const doctor = run(root, ['doctor']);
      assert.strictEqual(doctor.code, 0, doctor.out);
      assert.match(doctor.out, /1 contrato\(s\) legibles/);
      assert.match(doctor.out, /ignorados: .*README\.md/);
      assert.ok(!/encabezado ilegible/.test(doctor.out), 'must not report unreadable headers');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('status lists only real contracts', () => {
    const root = project();
    try {
      withFiles(root, {
        'FEAT-0001.md': CONTRACT,
        'README.md': '# Contratos\n',
        'notas.md': '# Notas\n'
      });

      const status = JSON.parse(run(root, ['status', '--json']).out);

      assert.strictEqual(status.contracts.length, 1);
      assert.strictEqual(status.contracts[0].id, 'FEAT-0001');
      assert.strictEqual(status.total_contracts, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('review ignores non-contracts', () => {
    const root = project();
    try {
      withFiles(root, {
        'FEAT-0001.md': CONTRACT,
        'README.md': '# Contratos\n'
      });

      const review = JSON.parse(run(root, ['review', '--json']).out);

      assert.strictEqual(review.summary.contracts, 1);
      assert.deepStrictEqual(review.contracts.map(row => row.id), ['FEAT-0001']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('contracts/ — real errors are still errors', () => {
  test('a contract header without ID and Status is reported', () => {
    const root = project();
    try {
      withFiles(root, {
        'FEAT-0001.md': CONTRACT,
        'roto.md': '# CONTRACT: sin encabezado\n\nCuerpo.\n'
      });

      const doctor = run(root, ['doctor']);

      assert.strictEqual(doctor.code, 1);
      assert.match(doctor.out, /encabezado ilegible: roto\.md/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

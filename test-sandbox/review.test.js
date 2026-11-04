/**
 * `sdd review` — coverage heatmap per contract.
 *
 * A criterion counts only when a test file that names the contract cites it in a
 * test title, so two contracts sharing `BR-001` do not absorb each other.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'sdd.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-review-'));

function contract(id, { br = [], ac = [] }) {
  const dir = path.join(root, 'contracts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), `# CONTRACT: ${id}
# ID: ${id}
# Status: APPROVED
# Mode: LOOP
# Gate-Mode: EXPRESS

## Business Rules
${br.map((text, index) => `- BR-00${index + 1}: ${text}`).join('\n')}

## Acceptance Criteria
${ac.map((text, index) => `- AC-00${index + 1}: ${text}`).join('\n')}
`, 'utf8');
}

function testFile(name, body) {
  const dir = path.join(root, 'tests');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body, 'utf8');
}

function review(args = []) {
  const result = spawnSync(process.execPath, [CLI, 'review', ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: root }
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  contract('FEAT-9001', { br: ['el total nunca es negativo', 'el cupón aplica una vez'], ac: ['el total es visible'] });
  contract('FEAT-9002', { br: ['el envío es gratis', 'el envío llega en 48h'], ac: [] });

  testFile('a.test.js', `
    const { test } = require('node:test');
    test('FEAT-9001 BR-001: el total nunca es negativo', () => {});
    test('FEAT-9001 — AC-001: el total es visible', () => {});
  `);
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('review — scoping', () => {
  test('a shared BR-001 only counts for the contract the test names', () => {
    const data = JSON.parse(review(['--json']).stdout);

    const first = data.contracts.find(row => row.id === 'FEAT-9001');
    const second = data.contracts.find(row => row.id === 'FEAT-9002');

    assert.strictEqual(first.covered, 2);
    assert.deepStrictEqual(first.orphans, ['BR-002']);
    assert.strictEqual(first.scoped, true);

    assert.strictEqual(second.covered, 0);
    assert.deepStrictEqual(second.orphans, ['BR-001', 'BR-002']);
    assert.strictEqual(second.scoped, false);
    assert.strictEqual(second.scopedFiles, 0);
  });

  test('a contract without a scoped test file is reported as such', () => {
    const { stdout } = review();
    assert.match(stdout, /sin tests que nombren el contrato/);
  });
});

describe('review — coverage', () => {
  test('a criterion only counts when it appears in a test title', () => {
    testFile('b.test.js', `
      const { test } = require('node:test');
      // FEAT-9002 appears in this comment and inside the body, but not in a title.
      test('el envío funciona', () => { const x = 'FEAT-9002 BR-001'; });
    `);

    const data = JSON.parse(review(['--json']).stdout);
    const second = data.contracts.find(row => row.id === 'FEAT-9002');

    assert.strictEqual(second.scoped, true, 'the file names the contract');
    assert.strictEqual(second.covered, 0, 'but no title cites the criterion');
  });

  test('fully covered contracts report no orphans', () => {
    testFile('c.test.js', `
      const { test } = require('node:test');
      test('FEAT-9002 BR-001: el envío es gratis', () => {});
      test('FEAT-9002 BR-002: el envío llega en 48h', () => {});
      test('FEAT-9001 BR-002: el cupón aplica una vez', () => {});
    `);

    const result = review(['--json']);
    const data = JSON.parse(result.stdout);

    assert.strictEqual(data.summary.orphans, 0);
    assert.strictEqual(data.summary.coverage, 100);
    assert.strictEqual(result.code, 0);
    assert.deepStrictEqual(data.orphan_specs, []);
  });
});

describe('review — reporting', () => {
  test('the summary and the exit code reflect the gaps', () => {
    // Replace the corpus so the gap is the only signal left.
    for (const name of ['a.test.js', 'b.test.js', 'c.test.js']) {
      fs.rmSync(path.join(root, 'tests', name), { force: true });
    }

    testFile('d.test.js', `
      const { test } = require('node:test');
      test('FEAT-9001 BR-001: el total nunca es negativo', () => {});
    `);

    const result = review();
    assert.strictEqual(result.code, 1);
    assert.match(result.stdout, /Huérfanos:/);
    assert.match(result.stdout, /FEAT-9001:AC-001/);
    assert.match(result.stdout, /█/);
  });

  test('the JSON exposes the corpus and the per-contract breakdown', () => {
    const data = JSON.parse(review(['--json']).stdout);

    assert.ok(Array.isArray(data.corpus.dirs));
    assert.ok(data.corpus.files >= 1);
    assert.strictEqual(data.summary.contracts, 2);
    assert.strictEqual(typeof data.summary.coverage, 'number');

    for (const row of data.contracts) {
      assert.strictEqual(typeof row.brTotal, 'number');
      assert.strictEqual(typeof row.acTotal, 'number');
      assert.ok(Array.isArray(row.orphans));
    }
  });
});

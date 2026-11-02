/**
 * Fixture project — end-to-end integration over the real CLI and MCP core.
 *
 * Builds the throw-away project in a temp directory (never committed) and
 * asserts that every documented edge case behaves as specified. This is the
 * regression net for format, gate, loop, telemetry and dashboard together.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildFixtureProject, EDGE_CASES } = require('./fixtures/demo-project.js');

let fixture;
const target = path.join(os.tmpdir(), `sdd-fixture-test-${process.pid}`);

before(() => {
  fixture = buildFixtureProject(target);
});

after(() => {
  fs.rmSync(target, { recursive: true, force: true });
});

function contractText(id) {
  const dir = path.join(target, 'contracts');
  const file = fs.readdirSync(dir).find(name => {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    return new RegExp(`^#\\s*ID:\\s*${id}\\s*$`, 'm').test(text);
  });
  return { file, text: fs.readFileSync(path.join(dir, file), 'utf8') };
}

describe('Fixture — shape', () => {
  test('builds ten contracts with a mixed status distribution', () => {
    assert.strictEqual(fixture.contracts, 10);

    const dir = path.join(target, 'contracts');
    const statuses = fs.readdirSync(dir).map(name =>
      (fs.readFileSync(path.join(dir, name), 'utf8').match(/^#\s*Status:\s*(\w+)$/m) || [])[1]
    );

    const count = wanted => statuses.filter(status => status === wanted).length;
    assert.strictEqual(count('DRAFT'), 5);
    assert.strictEqual(count('APPROVED'), 3);
    assert.strictEqual(count('RESOLVED'), 2);
  });

  test('every documented edge case reports its expected verdict', () => {
    assert.deepStrictEqual(
      fixture.edgeCases.map(edge => edge.id),
      EDGE_CASES.map(edge => edge.id)
    );
    assert.strictEqual(fixture.edgeCases.length, 6);
  });
});

describe('Fixture — gate behaviour', () => {
  test('the open assumption blocks approval', () => {
    const { text } = contractText('FEAT-0001');
    assert.match(text, /^## Inferred Assumptions$/m);
    assert.match(text, /^- \[ \] AS-01/m);
  });

  test('the contradiction and the budget overflow are real fixtures', () => {
    assert.match(contractText('FEAT-0005').text, /BR-001: monto > 0/);
    assert.match(contractText('FEAT-0005').text, /monto = 0/);
    assert.match(contractText('FEAT-0006').text, /BR-008:/);
  });

  test('a campaign file name is resolved by its ID', () => {
    const { file } = contractText('FIX-0001');
    assert.strictEqual(file, '02-FIX-0001-redondeo.md');
    assert.match(contractText('FIX-0001').text, /^---\ntype: fix\n---/);
  });

  test('waivers let a contract without story and over budget pass', () => {
    const { text } = contractText('FIX-0002');
    assert.ok(!/## User Story/.test(text));
    assert.match(text, /STORY-OK:/);
    assert.match(text, /BUDGET-OK:/);
  });
});

describe('Fixture — loop and telemetry', () => {
  test('the loop left a completed item, a failure and an interrupted one', () => {
    const { text } = contractText('FEAT-0002');
    assert.match(text, /# Main Flow \| arch \| arch-guard:FEAT-0002-main \| verifier \| ✅/);
    assert.match(text, /# AC-002 \| functional \| assertion:FEAT-0002-ac002 \| tester \| ❌/);
    assert.match(text, /# AC-003 \| functional \| assertion:FEAT-0002-ac003 \| tester \| ⏳/);
    assert.match(text, /^# Approved-By: /m);
    assert.match(text, /^# Approved-Hash: [0-9a-f]{12}$/m);
  });

  test('structured events were written for the claims and results', () => {
    const eventsFile = path.join(target, '.sdd', 'runs', 'FEAT-0002', 'events.ndjson');
    assert.ok(fs.existsSync(eventsFile));

    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.event === 'CLAIM'));
    assert.ok(events.some(event => event.event === 'RESULT' && event.result === 'FAIL'));
    assert.ok(events.some(event => event.event === 'RESULT' && event.result === 'PASS'));
  });

  test('usage separates MCP from CLI and attributes feature/fix work', () => {
    const usage = JSON.parse(fs.readFileSync(path.join(target, '.sdd', 'usage.json'), 'utf8'));

    assert.ok(usage.sources.mcp >= 3, 'the MCP session must be counted');
    assert.ok(usage.sources.cli > usage.sources.mcp, 'the CLI drives most of the fixture');
    assert.ok(usage.by_type.feature > 0, 'feature work must be attributed');
    assert.ok(usage.by_type.fix > 0, 'fix work must be attributed');
    assert.strictEqual(usage.sessions, 1);
    assert.strictEqual(usage.session_log.length, 1);
    assert.strictEqual(usage.session_log[0].client, 'Claude Code@2.1.0');
    assert.ok(usage.session_log[0].calls >= 3);
    assert.ok(!JSON.stringify(usage).includes(target), 'no local paths in the ledger');
  });

  test('metrics reflect the real outcomes', () => {
    const metrics = JSON.parse(fs.readFileSync(path.join(target, '.sdd', 'metrics.json'), 'utf8'));

    assert.ok(metrics.counters.steps_total >= 3);
    assert.strictEqual(metrics.counters.steps_fail, 1);
    assert.ok(metrics.first_pass_quality_rate > 0 && metrics.first_pass_quality_rate < 100);
    assert.ok(metrics.layer_success_rates.arch > 0);
  });
});

describe('Fixture — dashboard', () => {
  test('the generated dashboard shows identity, usage split and pending work', () => {
    const html = fs.readFileSync(fixture.dashboard, 'utf8');

    assert.match(html, /Proyecto: <span[^>]*>tienda-demo/);
    assert.match(html, /Origen del uso/);
    assert.match(html, /Tipo de trabajo/);
    assert.match(html, /Trabajo pendiente/);
    assert.match(html, /FEAT-0002/);
    assert.match(html, /en curso/);
    assert.match(html, /contrato\(s\) · \d+ ítem\(s\) abiertos/, 'pending summary must be present');
  });
});

/**
 * FEAT-0013 — Interop with external behavioral skills.
 *
 * The protocol is documentation-level, so these assertions guard the contract:
 * the file exists, both orchestrators wire it, and it never contradicts loop.md.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Read-only: no fixtures, no temp roots.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(REPO_ROOT, relative));

const interop = read('protocol/interop.md');
const loop = read('protocol/loop.md');
const gate = read('protocol/gate.md');
const contractFormat = read('protocol/contract.md');
const claudeOrchestrator = read('CLAUDE.md');
const agentsOrchestrator = read('AGENTS.md');
const readmeEn = read('README.md');
const readmeEs = read('README.es.md');
const changelog = read('CHANGELOG.md');

describe('FEAT-0013 — Business Rules', () => {
  test('BR-001: the protocol declares SDD-GL precedence over external behavioral skills', () => {
    assert.match(interop, /[Pp]recedencia/);
    assert.match(interop, /protocolo SDD-GL[^\n]*>\s*skills de comportamiento/i);
  });

  test('BR-002: interop is compatible with loop.md (no inline questions, no new exit routes)', () => {
    // loop.md forbids requesting approval during execution and only ends in RESOLVED or Gate.
    assert.match(loop, /Solicitar aprobación durante la ejecución/);
    assert.match(interop, /Nunca se pregunta de forma directa durante el Loop/);
    assert.match(interop, /`?Status: RESOLVED`?|`?Mode: GATE`? \+ `?Status: DRAFT`?/);
    assert.ok(!/pregunt[^\n]*al usuario durante el Loop(?!.*Ambiguity)/i.test(interop));
  });

  test('BR-003: every modified line traces back to the approved Contract', () => {
    assert.match(interop, /trazabilidad/i);
    assert.match(interop, /cada línea modificada se traza al Contract/i);
  });

  test('BR-004: the framework ceremonial is part of the task and cannot be trimmed', () => {
    assert.match(interop, /no se recorta|no puede recortar/i);
    assert.match(interop, /Completion Map/);
    assert.match(interop, /Glass Box/);
  });

  test('BR-005: the interop protocol is additive and does not modify gate/loop/contract', () => {
    assert.match(interop, /aditiva/i);
    assert.match(interop, /no reemplaza ni contradice/i);
    assert.match(interop, /gate\.md/);
    assert.match(interop, /loop\.md/);
    assert.match(interop, /contract\.md/);
  });

  test('BR-006: without behavioral skills the protocol is a explicit no-op', () => {
    assert.match(interop, /no-op/i);
    assert.match(interop, /comportamiento del ciclo es idéntico|se comporta exactamente igual/i);
  });
});

describe('FEAT-0013 — Alternative Flows', () => {
  test('AF-01: a dispute over the ceremonial is recorded in the Glass Box run', () => {
    assert.match(interop, /registra la\s+disputa en el run de Glass Box|registra[^\n]*Glass Box/i);
    assert.match(interop, /continúa/i);
  });

  test('AF-02: a contradictory "skipped" closing defers to the official report and may reopen Gate', () => {
    assert.match(interop, /COMPLETION REPORT/);
    assert.match(interop, /se reabre Gate|reabre Gate/i);
  });

  test('AF-03: a session without behavioral skills stays a no-op', () => {
    assert.match(interop, /No hay[^\n]*no-op|no hay → Modo Interop en \*\*no-op\*\*/i);
  });
});

describe('FEAT-0013 — Acceptance Criteria', () => {
  test('AC-001: GIVEN active behavioral skills WHEN a work item starts THEN both orchestrators load interop.md into agent context', () => {
    assert.ok(exists('protocol/interop.md'), 'protocol/interop.md must exist');

    for (const [name, orchestrator] of [['CLAUDE.md', claudeOrchestrator], ['AGENTS.md', agentsOrchestrator]]) {
      assert.match(orchestrator, /protocol\/interop\.md/, `${name} must reference protocol/interop.md`);
      assert.match(orchestrator, /Modo Interop|Interop Mode/, `${name} must announce Interop Mode`);
    }
  });

  test('AC-002: GIVEN Loop active WHEN uncertainty appears THEN Ambiguity Log + DRAFT/GATE + stop, never an inline question', () => {
    assert.match(interop, /Ambiguity Log/);
    assert.match(interop, /Mode: GATE/);
    assert.match(interop, /Status: DRAFT/);
    assert.match(interop, /detener y notificar|detener/i);
  });

  test('AC-003: GIVEN a STRICT contract WHEN a skill pushes to trim a section THEN the section is preserved and logged as a note', () => {
    assert.match(interop, /se conserva tal cual|se conserva/i);
    assert.match(interop, /nota para decisión\s+humana|como \*\*nota para decisión\s+humana\*\*/i);
    assert.match(gate, /STRICT/);
  });

  test('AC-004: GIVEN a N/N ✅ report WHEN a skill emits a "skipped" closing THEN no omitted work is declared', () => {
    assert.match(interop, /no se declara trabajo omitido/i);
    assert.match(interop, /fuente única del cierre/i);
  });

  test('AC-005: the interop consistency test validates file, orchestrator references and zero loop.md contradiction', () => {
    // Existence and wiring.
    assert.ok(exists('protocol/interop.md'));
    assert.ok(claudeOrchestrator.includes('protocol/interop.md'));
    assert.ok(agentsOrchestrator.includes('protocol/interop.md'));

    // Zero contradiction with loop.md: interop must not allow asking for approval mid-Loop.
    const loopForbidsApproval = /Solicitar aprobación durante la ejecución/.test(loop);
    const interopForbidsInline = /Nunca se pregunta de forma directa durante el Loop/.test(interop);
    assert.ok(loopForbidsApproval && interopForbidsInline);

    // Both protocols allow exactly the same exit routes.
    assert.match(loop, /escalado a Gate|vuelve a Gate|DETENER/);
    assert.match(interop, /escalado a Gate/i);

    // The new section is documented and released.
    assert.match(readmeEs, /protocol\/interop\.md/);
    assert.match(readmeEn, /protocol\/interop\.md/);
    assert.match(changelog, /\[0\.5\.0\]/);
    assert.match(changelog, /interop\.md/);

    // Inferred Assumptions (FEAT-0014) remain part of the contract format.
    assert.match(contractFormat, /## Inferred Assumptions|## Inferred Assumptions/);
  });
});

/**
 * The orchestrator docs are copied into real projects. If they freeze at an old
 * protocol version, the next agent starts with the wrong cycle — which is exactly
 * what happened in a project that kept AGENTS.md at v0.3.0.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ORCHESTRATORS = ['AGENTS.md', 'CLAUDE.md'];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('Orchestrator docs — protocol version', () => {
  test('both declare the version being released', () => {
    for (const file of ORCHESTRATORS) {
      const text = read(file);
      const match = text.match(/\*\*(?:Protocol version|Versión del protocolo): (\d+\.\d+\.\d+)\*\*/);

      assert.ok(match, `${file} must declare the protocol version`);
      assert.strictEqual(match[1], manifest.version, `${file} declares ${match[1]}, package is ${manifest.version}`);
    }
  });

  test('no stale protocol versions survive', () => {
    for (const file of ORCHESTRATORS) {
      const text = read(file);
      assert.ok(!/\b0\.[0-5]\.\d+\b/.test(text), `${file} still mentions an old version`);
    }
  });
});

describe('Orchestrator docs — current cycle', () => {
  test('the Gate documents the User Story and the budget', () => {
    for (const file of ORCHESTRATORS) {
      const text = read(file);

      assert.match(text, /User Story/, `${file} must mention the User Story`);
      assert.match(text, /STORY_MISSING/, `${file} must name the story failures`);
      assert.match(text, /BUDGET_EXCEEDED/, `${file} must name the budget failure`);
      assert.match(text, /PLACEHOLDER/, `${file} must name the placeholder guard`);
    }
  });

  test('the Loop documents the CLI and the map', () => {
    for (const file of ORCHESTRATORS) {
      const text = read(file);

      assert.match(text, /sdd loop/, `${file} must document sdd loop`);
      assert.match(text, /sdd validate/, `${file} must document sdd validate`);
      assert.match(text, /sdd reconcile/, `${file} must document sdd reconcile`);
      assert.match(text, /Completion Map/, `${file} must describe the Completion Map`);
      assert.match(text, /⏳/, `${file} must explain the interrupted item`);
    }
  });

  test('contracts/README.md is explicitly not a contract', () => {
    for (const file of ORCHESTRATORS) {
      assert.match(read(file), /README/, `${file} must warn about non-contract markdown`);
    }
  });
});

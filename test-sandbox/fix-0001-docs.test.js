/**
 * FIX-0001 — Manifests, MCP spec and per-platform install documentation must match
 * the real repository state.
 *
 * Every test name carries its criterion ID (CONSTITUTION §3 traceability).
 * Read-only: this suite never mutates the repository.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { TOOLS } = require('../mcp/server.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(REPO_ROOT, relative));

const rootManifest = JSON.parse(read('package.json'));
const mcpManifest = JSON.parse(read('mcp/package.json'));
const pluginManifest = JSON.parse(read('plugin.json'));
const spec = read('mcp/sdd-gl-mcp-spec.md');

const TOOL_NAMES = TOOLS.map(tool => tool.name).sort();

describe('FIX-0001 — Business Rules', () => {
  test('BR-001: the three manifests declare the same version', () => {
    assert.strictEqual(rootManifest.version, '0.4.0');
    assert.strictEqual(mcpManifest.version, rootManifest.version);
    assert.strictEqual(pluginManifest.version, rootManifest.version);
  });

  test('BR-002: the spec documents exactly the tools the server exposes', () => {
    const documented = [...spec.matchAll(/^###\s+`(sdd_[a-z_]+)`/gm)].map(match => match[1]).sort();

    assert.deepStrictEqual(documented, TOOL_NAMES, 'documented tool set must equal tools/list');
    assert.strictEqual(TOOL_NAMES.length, 8);
  });

  test('BR-003: the client configuration section covers Claude Code, Antigravity and OpenCode', () => {
    assert.match(spec, /Claude Code/);
    assert.match(spec, /Gemini\s*\/\s*Antigravity|Antigravity/);
    assert.match(spec, /OpenCode/);
  });

  test('BR-004: INSTALACION.md documents remote, local and installed-package methods', () => {
    const guide = read('docs/INSTALACION.md');

    assert.match(guide, /npx/, 'remote npx method');
    assert.match(guide, /node\s+\.\/mcp\/server\.js/, 'local method');
    assert.match(guide, /npm install/, 'installed dependency method');
  });

  test('BR-005: the dashboard command is documented', () => {
    const guide = read('docs/INSTALACION.md');

    assert.match(spec, /node mcp\/dashboard-gen\.js/, 'spec must document the dashboard command');
    assert.match(guide, /node mcp\/dashboard-gen\.js/, 'install guide must document the dashboard command');
  });

  test('BR-006: the spec states the platform-agnostic nature of the protocol', () => {
    assert.match(spec, /[Aa]gnóstic|[Aa]gnostic/);
    assert.match(spec, /capa de integración|integration layer/i);
  });

  test('AF-01: every path declared in the plugin manifest exists', () => {
    const declared = [];

    for (const platform of Object.values(pluginManifest.platforms || {})) {
      for (const key of ['orchestrator', 'commands', 'agents', 'skills']) {
        if (platform[key]) declared.push(platform[key]);
      }
    }
    for (const skill of pluginManifest.skills || []) declared.push(skill.file);
    for (const skill of pluginManifest.subagent_skills || []) declared.push(skill.file);
    for (const protocol of Object.values(pluginManifest.protocol || {})) {
      if (typeof protocol === 'string' && protocol.includes('/')) declared.push(protocol);
    }

    const missing = declared.filter(relative => !exists(relative));
    assert.deepStrictEqual(missing, [], `manifest references missing paths: ${missing.join(', ')}`);
  });

  test('AF-02: the transport is documented as stdio JSON-RPC instead of omitted', () => {
    assert.match(spec, /stdio/);
    assert.match(spec, /JSON-RPC/);
  });
});

describe('FIX-0001 — Acceptance Criteria', () => {
  test('AC-001: GIVEN the three manifests WHEN versions are compared THEN all are 0.4.0', () => {
    const versions = [rootManifest.version, mcpManifest.version, pluginManifest.version];
    assert.deepStrictEqual(versions, ['0.4.0', '0.4.0', '0.4.0']);
  });

  test('AC-002: GIVEN tools/list WHEN compared with the spec THEN 8 tools = 8 documented', () => {
    const documented = [...spec.matchAll(/^###\s+`(sdd_[a-z_]+)`/gm)].map(match => match[1]);

    assert.strictEqual(TOOL_NAMES.length, 8);
    assert.strictEqual(new Set(documented).size, 8);
    for (const name of TOOL_NAMES) {
      assert.ok(documented.includes(name), `tool ${name} must be documented`);
    }
  });

  test('AC-003: GIVEN the spec WHEN inspected THEN it does not contain sdd_load_preset', () => {
    assert.ok(!spec.includes('sdd_load_preset'));
  });

  test('AC-004: GIVEN INSTALACION.md WHEN read THEN Claude Code, Gemini/Antigravity and OpenCode are covered', () => {
    const guide = read('docs/INSTALACION.md');

    assert.match(guide, /Claude Code/);
    assert.match(guide, /Gemini|Antigravity/, 'Antigravity is documented as Gemini CLI');
    assert.match(guide, /OpenCode/);
  });

  test('AC-005: GIVEN the documentation WHEN the dashboard is needed THEN a command is documented', () => {
    assert.match(read('docs/INSTALACION.md'), /node mcp\/dashboard-gen\.js/);
  });

  test('AC-006: GIVEN the MCP client section WHEN read THEN the protocol is stack and platform agnostic', () => {
    assert.match(spec, /100% agnóstica|100% agnostic/);
    assert.match(spec, /Gate\/Loop/);
    assert.match(spec, /Completion Map/);
  });
});

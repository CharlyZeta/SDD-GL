/**
 * Publish surface — the tarball must contain the tool and nothing private.
 *
 * Guards the FEAT-0012 privacy rule at packaging time: `contracts/` and `.sdd/`
 * can never end up inside the published package.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

let packCache = null;

function pack() {
  if (packCache) return packCache;

  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true
  });

  assert.strictEqual(result.status, 0, `npm pack failed:\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  packCache = parsed[0];
  return packCache;
}

describe('Publish — manifest', () => {
  test('the package is public, unscoped and points at the repository', () => {
    // Unscoped on purpose: a scope would require an npm organization.
    assert.strictEqual(manifest.name, 'sdd-gl');
    assert.ok(!manifest.name.startsWith('@'), 'the package must stay unscoped');
    assert.strictEqual(manifest.publishConfig.access, 'public');
    assert.match(manifest.repository.url, /github\.com\/CharlyZeta\/SDD-GL/);
    assert.strictEqual(manifest.license, 'MIT');
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'LICENSE')));
  });

  test('the entry points exist', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, manifest.main)), 'main must exist');

    for (const [name, relative] of Object.entries(manifest.bin)) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, relative)), `bin ${name} must exist`);
      assert.match(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8').slice(0, 200), /^#!/, `bin ${name} needs a shebang`);
    }

    assert.ok(manifest.bin.sdd, 'the CLI must be exposed as sdd');
  });

  test('every declared path is real', () => {
    for (const entry of manifest.files) {
      if (entry.startsWith('!')) continue;
      const target = path.join(REPO_ROOT, entry.replace(/\/$/, ''));
      assert.ok(fs.existsSync(target), `files entry ${entry} must exist`);
    }
  });
});

describe('Publish — release consistency', () => {
  test('manifests, badges and changelog agree on one version', () => {
    const result = spawnSync(process.execPath, ['scripts/release.js', '--check', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });

    const report = JSON.parse(result.stdout);
    assert.strictEqual(result.status, 0, `release check failed: ${report.problems?.join('; ')}`);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.version, manifest.version);
  });

  test('the release checklist exists and is linked', () => {
    const file = path.join(REPO_ROOT, 'docs', 'DEPLOY.md');
    assert.ok(fs.existsSync(file));

    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /npm publish/);
    assert.match(text, /release\.js/);
    assert.match(fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8'), /DEPLOY\.md/);
  });
});

describe('Publish — tarball contents', () => {
  test('ships the tool, the protocol and the orchestrators', () => {
    const files = pack().files.map(entry => entry.path);

    for (const required of [
      'mcp/server.js',
      'mcp/dashboard-gen.js',
      'bin/sdd.js',
      'protocol/contract.md',
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'LICENSE'
    ]) {
      assert.ok(files.includes(required), `${required} must be published`);
    }
  });

  test('ships the agent adapters so init can scaffold them', () => {
    const files = pack().files.map(entry => entry.path);

    assert.ok(files.some(file => file.startsWith('.agents/skills/')), 'the skills must ship');
    assert.ok(files.some(file => file.startsWith('.claude/agents/')), 'the agent adapters must ship');
    assert.ok(files.some(file => file.startsWith('.claude/commands/')), 'the commands must ship');
  });

  test('never ships contracts, state, tests or the dashboard build', () => {
    const files = pack().files.map(entry => entry.path);
    const forbidden = ['contracts/', '.sdd/', 'test-sandbox/', 'docs/index.html', 'docs/assets/', '.git/'];

    for (const file of files) {
      for (const prefix of forbidden) {
        assert.ok(!file.startsWith(prefix), `${file} must not be published`);
      }
    }
  });

  test('stays small and declares a runtime', () => {
    const details = pack();

    // 44 entries: the tool, the protocol, the presets and the agent adapters.
    assert.ok(details.entryCount <= 60, `expected a curated tarball, got ${details.entryCount} files`);
    assert.ok(details.unpackedSize < 2_000_000, 'the tarball must stay under 2 MB');
    assert.match(manifest.engines.node, />=18/);
  });
});

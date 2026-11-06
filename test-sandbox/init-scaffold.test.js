/**
 * `sdd init --with-agents` scaffolds the orchestrators, the protocol and the
 * platform adapters shipped with the package, so a fresh project starts with the
 * current cycle instead of a stale hand-copied AGENTS.md.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'sdd.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--root', cwd], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SDD_PROJECT_ROOT: cwd }
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-init-'));
}

describe('init --with-agents', () => {
  test('copies the orchestrators, the protocol and the adapters', () => {
    const root = project();
    try {
      const result = run(root, ['init', '--with-agents', '--json']);
      assert.strictEqual(result.code, 0, result.out);

      for (const relative of [
        'AGENTS.md',
        'CLAUDE.md',
        'protocol/contract.md',
        'protocol/gate.md',
        'protocol/loop.md',
        'protocol/interop.md',
        '.agents/skills/sdd-gate/SKILL.md',
        '.claude/agents/requirements-agent.md',
        '.claude/commands/sdd-feature.md'
      ]) {
        assert.ok(fs.existsSync(path.join(root, relative)), `${relative} must be scaffolded`);
      }

      assert.strictEqual(fs.readdirSync(path.join(root, '.agents', 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).length, 14);
      assert.strictEqual(fs.readdirSync(path.join(root, '.claude', 'agents')).length, 6);
      assert.strictEqual(fs.readdirSync(path.join(root, '.claude', 'commands')).length, 6);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('the copied orchestrators carry the released protocol version', () => {
    const root = project();
    try {
      run(root, ['init', '--with-agents']);

      const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
      const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');

      assert.match(agents, new RegExp(`Protocol version: ${manifest.version}`));
      assert.match(claude, new RegExp(`Versión del protocolo: ${manifest.version}`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('sdd sync passes in the scaffolded project', () => {
    const root = project();
    try {
      run(root, ['init', '--with-agents']);
      const sync = run(root, ['sync']);

      assert.strictEqual(sync.code, 0, sync.out);
      assert.match(sync.stdout, /6 par\(es\) de agente sincronizados/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('init --with-agents — safety', () => {
  test('never overwrites a file the project already owns', () => {
    const root = project();
    try {
      run(root, ['init', '--with-agents']);

      const agentsPath = path.join(root, 'AGENTS.md');
      fs.writeFileSync(agentsPath, `${fs.readFileSync(agentsPath, 'utf8')}\n<!-- local -->\n`, 'utf8');

      const second = run(root, ['init', '--with-agents', '--json']);
      const report = JSON.parse(second.stdout);

      assert.strictEqual(report.created.length, 0, 'a second run must create nothing');
      assert.ok(report.skipped.includes('AGENTS.md'));
      assert.match(fs.readFileSync(agentsPath, 'utf8'), /<!-- local -->/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('plain init does not scaffold the adapters', () => {
    const root = project();
    try {
      run(root, ['init']);

      assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
      assert.ok(!fs.existsSync(path.join(root, '.agents')));
      assert.ok(fs.existsSync(path.join(root, 'contracts')), 'contracts/ is still created');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('init --with-agents — doctor', () => {
  test('doctor reports the orchestrators as current', () => {
    const root = project();
    try {
      run(root, ['init', '--with-agents']);
      const doctor = run(root, ['doctor']);

      assert.match(doctor.out, /orquestadores .*al día con el paquete/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('doctor flags an orchestrator from an older release', () => {
    const root = project();
    try {
      run(root, ['init', '--with-agents']);

      const agentsPath = path.join(root, 'AGENTS.md');
      fs.writeFileSync(agentsPath, fs.readFileSync(agentsPath, 'utf8').replace(manifest.version, '0.3.0'), 'utf8');

      const doctor = run(root, ['doctor']);

      assert.match(doctor.out, /AGENTS\.md no declara/);
      assert.match(doctor.out, /sdd init --with-agents/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

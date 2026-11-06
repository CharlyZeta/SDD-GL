/**
 * Documentation consistency — the README is published on npm, so a contradiction
 * there is visible to every user. Reported by a reviewer agent:
 *  - the badge said "published" while Known Limitations said the opposite
 *  - three different versions coexisted in prose
 *  - the repo tree listed fewer CLI commands than the usage table
 *  - "four bundled agents" survived from the 0.1.0 roadmap
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const README_ES = fs.readFileSync(path.join(ROOT, 'README.es.md'), 'utf8');

function count(dir, kind) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .filter(entry => (kind === 'dir' ? entry.isDirectory() : entry.isFile()))
    .length;
}

function cliCommands() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sdd.js'), '--help'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return [...result.stdout.matchAll(/^\s{2}([a-z][a-z-]*)(?:\s|$)/gm)]
    .map(match => match[1])
    .filter(name => name !== 'sdd');
}

describe('README — the published page does not contradict itself', () => {
  test('it does not claim the package is unpublished', () => {
    assert.ok(!/Not published to npm/i.test(README), 'EN README still says it is not published');
    assert.ok(!/No publicado en npm/i.test(README_ES), 'ES README still says it is not published');
    assert.match(README, /npmjs\.com\/package\/sdd-gl/, 'the npm badge/link must be present');
  });

  test('the roadmap does not leave the publish step unchecked', () => {
    assert.ok(!/- \[ \] .*npm publish/i.test(README), 'the roadmap still has npm publish unchecked');
  });
});

describe('README — no stale version in prose', () => {
  test('headings and the tree do not pin a version', () => {
    // The badge, the orchestrators and the CHANGELOG carry the version; prose must not.
    assert.ok(!/Known Limitations \(Version \d/.test(README));
    assert.ok(!/Limitaciones Conocidas \(Versión \d/.test(README_ES));
    assert.ok(!/Version history \(current: \d/.test(README));
    assert.ok(!/Historial de versiones \(actual: \d/.test(README_ES));
  });
});

describe('README — counts match the repository', () => {
  test('skills, slash commands and agent adapters are accurate', () => {
    const skills = count('.agents/skills', 'dir');
    const commands = count('.claude/commands', 'file');
    const agents = count('.claude/agents', 'file');

    assert.match(README, new RegExp(`${skills} skills`), `README must say ${skills} skills`);
    assert.match(README, new RegExp(`${commands} slash commands`), `README must say ${commands} slash commands`);
    assert.match(README, new RegExp(`${agents} agent adapters`), `README must say ${agents} agent adapters`);
  });

  test('sdd sync agrees with those counts', () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sdd.js'), 'sync'], {
      cwd: ROOT,
      encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, new RegExp(`${count('.claude/agents', 'file')} par`));
  });
});

describe('README — CLI coverage', () => {
  test('every command from the help appears in the usage table', () => {
    const commands = cliCommands();
    assert.ok(commands.length >= 10, `expected the full command list, got ${commands.join(', ')}`);

    for (const command of commands) {
      assert.ok(
        README.includes(`\`sdd ${command}`),
        `README does not document "sdd ${command}"`
      );
    }
  });

  test('the repository tree lists the same commands as the binary', () => {
    const line = README.split('\n').find(entry => entry.includes('sdd.js') && entry.includes('CLI:'));
    assert.ok(line, 'the tree must describe bin/sdd.js');

    for (const command of cliCommands()) {
      assert.ok(line.includes(command), `the tree omits "${command}"`);
    }
  });
});

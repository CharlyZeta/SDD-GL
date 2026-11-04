#!/usr/bin/env node

/**
 * Release helper — keeps the version in sync across the four places that show it
 * and refuses to publish when the manifests, the badges or the CHANGELOG drift.
 *
 *   node scripts/release.js --check        # exit 1 when something is out of sync
 *   node scripts/release.js 0.6.2          # set the version everywhere and rebuild the dashboards
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFESTS = ['package.json', 'mcp/package.json', 'plugin.json'];
const BADGES = ['README.md', 'README.es.md'];
const SEMVER = /^\d+\.\d+\.\d+$/;

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function writeJson(relative, value) {
  fs.writeFileSync(path.join(ROOT, relative), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function badgePattern() {
  return /badge\/version-(\d+\.\d+\.\d+)-blue/;
}

function changelogVersions() {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  return [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]);
}

function check() {
  const problems = [];
  const versions = MANIFESTS.map(relative => ({ relative, version: readJson(relative).version }));

  for (const { relative, version } of versions) {
    if (version !== versions[0].version) {
      problems.push(`${relative} declara ${version}, package.json declara ${versions[0].version}`);
    }
  }

  const version = versions[0].version;

  for (const relative of BADGES) {
    const match = fs.readFileSync(path.join(ROOT, relative), 'utf8').match(badgePattern());
    if (!match) problems.push(`${relative} no tiene badge de versión`);
    else if (match[1] !== version) problems.push(`${relative} muestra ${match[1]}, package.json declara ${version}`);
  }

  // Newest first: the top entry must be the version being released.
  if (changelogVersions()[0] !== version) {
    problems.push(`CHANGELOG.md encabeza con ${changelogVersions()[0] || '(sin entrada)'}, package.json declara ${version}`);
  }

  return { ok: problems.length === 0, version, problems };
}

function setVersion(version) {
  const current = readJson('package.json').version;
  if (!SEMVER.test(version)) throw new Error(`versión inválida: ${version} (se espera X.Y.Z)`);
  if (version === current) throw new Error(`la versión ya es ${version}`);

  for (const relative of MANIFESTS) {
    const manifest = readJson(relative);
    manifest.version = version;
    writeJson(relative, manifest);
  }

  const lock = readJson('package-lock.json');
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  writeJson('package-lock.json', lock);

  for (const relative of BADGES) {
    const file = path.join(ROOT, relative);
    const text = fs.readFileSync(file, 'utf8');
    if (!badgePattern().test(text)) throw new Error(`${relative} no tiene badge de versión`);
    fs.writeFileSync(file, text.replace(badgePattern(), `badge/version-${version}-blue`), 'utf8');
  }

  return { from: current, to: version };
}

function rebuildDashboards() {
  const { generateDashboard } = require(path.join(ROOT, 'mcp', 'dashboard-gen.js'));
  generateDashboard();
  generateDashboard(ROOT, { publicShowcase: true });
}

function main() {
  const argument = process.argv[2];

  if (!argument || argument === '--check') {
    const result = check();
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    }

    if (result.ok) {
      console.log(`✅ Versión ${result.version} consistente en manifiestos, badges y CHANGELOG.`);
      return 0;
    }

    console.log(`⛔ Versión ${result.version} inconsistente:`);
    for (const problem of result.problems) console.log(`   - ${problem}`);
    return 1;
  }

  const { from, to } = setVersion(argument);
  rebuildDashboards();

  console.log(`✅ ${from} → ${to} en ${MANIFESTS.length} manifiestos, ${BADGES.length} badges y package-lock.`);
  console.log('   Dashboards regenerados.');
  console.log(`\nSiguiente paso: agregá la entrada ## [${to}] en CHANGELOG.md y corré:`);
  console.log('   npm test && git commit -am "chore(release): ' + to + '" && git push');
  return 0;
}

process.exit(main());

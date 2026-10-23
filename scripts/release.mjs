#!/usr/bin/env node
/**
 * Publicación de versiones de Nexo (sin dependencias externas).
 *
 * Una sola versión para todo el monorepo (API, web, Edge e infraestructura), derivada de los commits convencionales:
 *   feat → minor · fix/perf → patch · `tipo!:` o "BREAKING CHANGE" → major.
 *
 * Uso:
 *   node scripts/release.mjs prepare [auto|major|minor|patch] [--dry-run]
 *       Calcula la versión, actualiza los package.json y package-lock.json, agrega la sección al CHANGELOG.md y crea
 *       el commit `chore(release): vX.Y.Z` y la etiqueta anotada `vX.Y.Z`. No hace push.
 *   node scripts/release.mjs notes <vX.Y.Z>     Imprime las notas de esa versión (desde CHANGELOG.md).
 *   node scripts/release.mjs check <vX.Y.Z>     Falla si alguna versión del monorepo no coincide con la etiqueta.
 *   node scripts/release.mjs current            Imprime la versión actual.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['.', 'apps/api', 'apps/web', 'apps/edge', 'infra'];
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const CHANGELOG_HEADER =
  '# Registro de cambios\n\n' +
  'Todas las versiones de Nexo. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y\n' +
  '[versionado semántico](https://semver.org/lang/es/). Generado por `scripts/release.mjs` a partir de los commits\n' +
  'convencionales.\n';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const COMMIT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const SECTIONS = [
  ['breaking', 'Cambios incompatibles'],
  ['feat', 'Nuevas funcionalidades'],
  ['fix', 'Correcciones'],
  ['perf', 'Rendimiento'],
  ['refactor', 'Refactorización'],
  ['docs', 'Documentación'],
  ['test', 'Pruebas'],
];

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

export function parseVersion(version) {
  const m = SEMVER.exec(version);
  if (!m) throw new Error(`Versión inválida: ${version} (se espera X.Y.Z)`);
  return m.slice(1).map(Number);
}

export function bumpVersion(version, bump) {
  const [major, minor, patch] = parseVersion(version);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Incremento inválido: ${bump}`);
}

/** Clasifica commits `{ subject, body }` en secciones del CHANGELOG y calcula el incremento mínimo. */
export function classifyCommits(commits) {
  const groups = Object.fromEntries(SECTIONS.map(([key]) => [key, []]));
  let bump = null;
  const raise = (level) => {
    const order = ['patch', 'minor', 'major'];
    if (!bump || order.indexOf(level) > order.indexOf(bump)) bump = level;
  };
  for (const { subject, body } of commits) {
    const m = COMMIT.exec(subject);
    if (!m) continue;
    const [, type, scope, bang, description] = m;
    if (type === 'chore' && scope === 'release') continue;
    const line = scope ? `**${scope}:** ${description}` : description;
    const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
    if (breaking) {
      const note = /^BREAKING[ -]CHANGE:\s*(.+)$/m.exec(body)?.[1];
      groups.breaking.push(note ? `${line} — ${note}` : line);
      raise('major');
    }
    if (type === 'feat') raise('minor');
    if (type === 'fix' || type === 'perf') raise('patch');
    groups[type]?.push(line);
  }
  return { groups, bump };
}

export function renderSection(version, date, groups) {
  const parts = [`## [${version}] - ${date}`];
  for (const [key, title] of SECTIONS) {
    if (groups[key]?.length) parts.push(`### ${title}\n\n${groups[key].map((l) => `- ${l}`).join('\n')}`);
  }
  if (parts.length === 1) parts.push('Sin cambios funcionales (mantenimiento).');
  return `${parts.join('\n\n')}\n`;
}

/** Extrae la sección de una versión del CHANGELOG (sin el título). */
export function extractNotes(changelog, version) {
  const start = changelog.indexOf(`## [${version}]`);
  if (start < 0) return null;
  const rest = changelog.slice(start);
  const next = rest.indexOf('\n## [', 1);
  return (next < 0 ? rest : rest.slice(0, next)).split('\n').slice(1).join('\n').trim();
}

/** Reemplaza la versión de nivel superior de un package.json o package-lock.json sin reformatear el archivo. */
export function setJsonVersion(text, version, isLock) {
  let out = text.replace(/^( {2}"version": )"[^"]*"/m, `$1"${version}"`);
  if (isLock) out = out.replace(/("packages": \{\s*"": \{[^}]*?"version": )"[^"]*"/, `$1"${version}"`);
  const parsed = JSON.parse(out);
  const ok =
    parsed.version === version && (!isLock || !parsed.packages?.[''] || parsed.packages[''].version === version);
  if (!ok) throw new Error('No se pudo actualizar la versión');
  return out;
}

function readVersions() {
  return PACKAGES.map((dir) => {
    const file = path.join(ROOT, dir, 'package.json');
    return { dir, version: JSON.parse(readFileSync(file, 'utf8')).version };
  });
}

function currentVersion() {
  const versions = readVersions();
  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length !== 1) fail(`versiones desalineadas: ${versions.map((v) => `${v.dir}=${v.version}`).join(', ')}`);
  return distinct[0];
}

function lastTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*');
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? [`${tag}..HEAD`] : [];
  const raw = git('log', '--no-merges', '--format=%s%x1f%b%x1e', ...range);
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject, body = ''] = entry.split('\x1f');
      return { subject: subject.trim(), body };
    })
    .reverse();
}

function prepare(requested, dryRun) {
  if (!dryRun && git('status', '--porcelain'))
    fail('hay cambios sin confirmar; confirme o descarte antes de publicar.');
  const current = currentVersion();
  const tag = lastTag();
  const commits = commitsSince(tag);
  const { groups, bump: suggested } = classifyCommits(commits);

  let next;
  if (!tag && requested === 'auto') {
    next = current; // Primera publicación: se etiqueta la versión declarada.
  } else {
    const bump = requested === 'auto' ? suggested : requested;
    if (!bump) fail(`no hay commits feat/fix/perf ni cambios incompatibles desde ${tag}; indique el incremento.`);
    next = bumpVersion(current, bump);
  }
  if (git('tag', '--list', `v${next}`)) fail(`la etiqueta v${next} ya existe.`);

  const date = new Date().toISOString().slice(0, 10);
  const section = renderSection(next, date, groups);
  console.log(`Versión: ${current} → ${next} (${commits.length} commits desde ${tag ?? 'el inicio'})\n`);
  console.log(section);
  if (dryRun) return;

  for (const dir of PACKAGES) {
    for (const name of ['package.json', 'package-lock.json']) {
      const file = path.join(ROOT, dir, name);
      if (!existsSync(file)) continue;
      writeFileSync(file, setJsonVersion(readFileSync(file, 'utf8'), next, name === 'package-lock.json'));
    }
  }
  const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : CHANGELOG_HEADER;
  const body = existing.startsWith(CHANGELOG_HEADER) ? existing.slice(CHANGELOG_HEADER.length) : `\n${existing}`;
  writeFileSync(CHANGELOG, `${CHANGELOG_HEADER}\n${section}${body.replace(/^\n*/, body.trim() ? '\n' : '')}`);

  git(
    'add',
    'CHANGELOG.md',
    ...PACKAGES.flatMap((d) => [`${d}/package.json`, `${d}/package-lock.json`]).filter((f) =>
      existsSync(path.join(ROOT, f)),
    ),
  );
  git('commit', '-m', `chore(release): v${next}`);
  git('tag', '-a', `v${next}`, '-m', `Nexo v${next}`);
  console.log(`Listo. Publique con: git push --follow-tags origin HEAD`);
}

function main() {
  const [command, arg, ...flags] = process.argv.slice(2);
  switch (command) {
    case 'prepare': {
      const bump = arg && !arg.startsWith('--') ? arg : 'auto';
      if (!['auto', 'major', 'minor', 'patch'].includes(bump)) fail(`incremento inválido: ${bump}`);
      return prepare(bump, [arg, ...flags].includes('--dry-run'));
    }
    case 'notes': {
      const version = (arg ?? '').replace(/^v/, '');
      const notes = existsSync(CHANGELOG) ? extractNotes(readFileSync(CHANGELOG, 'utf8'), version) : null;
      if (notes === null) fail(`CHANGELOG.md no tiene la versión ${version}.`);
      return console.log(notes);
    }
    case 'check': {
      const version = (arg ?? '').replace(/^v/, '');
      parseVersion(version);
      const wrong = readVersions().filter((v) => v.version !== version);
      if (wrong.length)
        fail(`la etiqueta v${version} no coincide con: ${wrong.map((v) => `${v.dir}=${v.version}`).join(', ')}`);
      return console.log(`Versiones alineadas con v${version}.`);
    }
    case 'current':
      return console.log(currentVersion());
    default:
      fail('comando desconocido. Use prepare | notes | check | current.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

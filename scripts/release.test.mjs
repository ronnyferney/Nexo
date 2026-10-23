// Pruebas del script de publicación: node --test scripts/release.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumpVersion, classifyCommits, extractNotes, renderSection, setJsonVersion } from './release.mjs';

const c = (subject, body = '') => ({ subject, body });

test('incrementa versiones semánticas', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.2', 'patch'));
});

test('deriva el incremento de los commits convencionales', () => {
  assert.equal(classifyCommits([c('docs: guía'), c('fix: error')]).bump, 'patch');
  assert.equal(classifyCommits([c('fix: error'), c('feat(api): nueva')]).bump, 'minor');
  assert.equal(classifyCommits([c('feat!: quita v1')]).bump, 'major');
  assert.equal(classifyCommits([c('refactor: x', 'BREAKING CHANGE: cambia la API')]).bump, 'major');
  assert.equal(classifyCommits([c('docs: solo docs'), c('Merge branch x')]).bump, null);
});

test('agrupa por sección, ignora commits de publicación y conserva el ámbito', () => {
  const { groups } = classifyCommits([
    c('feat(web): panel'),
    c('chore(release): v1.0.0'),
    c('refactor: núcleo', 'BREAKING CHANGE: cambia el contrato'),
  ]);
  assert.deepEqual(groups.feat, ['**web:** panel']);
  assert.deepEqual(groups.breaking, ['núcleo — cambia el contrato']);
  assert.deepEqual(groups.refactor, ['núcleo']);
  assert.equal(renderSection('1.1.0', '2026-10-23', groups).split('\n')[0], '## [1.1.0] - 2026-10-23');
});

test('extrae las notas de una versión del CHANGELOG', () => {
  const log = '# Registro\n\n## [1.1.0] - 2026-10-23\n\n### Correcciones\n\n- a\n\n## [1.0.0] - 2026-10-01\n\n- b\n';
  assert.equal(extractNotes(log, '1.1.0'), '### Correcciones\n\n- a');
  assert.equal(extractNotes(log, '1.0.0'), '- b');
  assert.equal(extractNotes(log, '9.9.9'), null);
});

test('actualiza la versión de package.json y package-lock.json sin tocar dependencias', () => {
  const pkg = '{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": {\n    "y": "1.0.0"\n  }\n}\n';
  assert.equal(JSON.parse(setJsonVersion(pkg, '1.1.0', false)).dependencies.y, '1.0.0');
  const lock =
    '{\n  "name": "x",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "x",\n' +
    '      "version": "1.0.0"\n    },\n    "node_modules/y": {\n      "version": "1.0.0"\n    }\n  }\n}\n';
  const out = JSON.parse(setJsonVersion(lock, '1.1.0', true));
  assert.equal(out.version, '1.1.0');
  assert.equal(out.packages[''].version, '1.1.0');
  assert.equal(out.packages['node_modules/y'].version, '1.0.0');
});

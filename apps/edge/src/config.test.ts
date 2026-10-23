import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, expandEnv, parseEdgeConfig } from './config';

const YAML = `
connections:
  astrans:
    engine: mssql
    host: 10.0.0.5
    port: 1433
    database: ASTRANS
    user: \${DB_USER:-nexo_lectura}
    password: \${ASTRANS_DB_PASSWORD}
    allowedTables: [dbo.vehiculos, dbo.viajes]
    maxRows: 1000
  bodega:
    engine: postgres
    host: db.local
    database: bodega
    user: nexo
    password: "\${BODEGA_PASS}"
    ssl: true
    allowWrites: true
`;

describe('parseEdgeConfig', () => {
  it('lee conexiones con variables de entorno y políticas', () => {
    const cfg = parseEdgeConfig(YAML, { ASTRANS_DB_PASSWORD: 's3creta', BODEGA_PASS: 'otra' });
    assert.deepEqual(Object.keys(cfg.connections), ['astrans', 'bodega']);
    assert.equal(cfg.connections.astrans.password, 's3creta');
    assert.equal(cfg.connections.astrans.user, 'nexo_lectura');
    assert.equal(cfg.connections.astrans.allowWrites, false);
    assert.equal(cfg.connections.astrans.maxRows, 1000);
    assert.deepEqual(cfg.connections.astrans.allowedTables, ['dbo.vehiculos', 'dbo.viajes']);
    assert.equal(cfg.connections.bodega.ssl, true);
    assert.equal(cfg.connections.bodega.allowWrites, true);
  });

  it('variable obligatoria ausente → error claro', () => {
    assert.throws(() => parseEdgeConfig(YAML, { BODEGA_PASS: 'x' }), /ASTRANS_DB_PASSWORD no está definida/);
  });

  it('valida motor, campos obligatorios, límites y nombres', () => {
    const base = (extra: string) =>
      `connections:\n  c:\n    engine: postgres\n    host: h\n    database: d\n    user: u\n${extra}`;
    assert.throws(() => parseEdgeConfig(base('    maxRows: 99999\n'), {}), ConfigError);
    assert.throws(() => parseEdgeConfig(base('    allowWrites: quizas\n'), {}), /true o false/);
    assert.throws(() => parseEdgeConfig(base('    allowedTables: algo\n'), {}), /allowedTables/);
    assert.throws(
      () => parseEdgeConfig('connections:\n  c:\n    engine: oracle\n    host: h\n    database: d\n    user: u\n', {}),
      /engine/,
    );
    assert.throws(() => parseEdgeConfig('connections:\n  c:\n    engine: mysql\n    host: h\n', {}), /database/);
    assert.throws(() => parseEdgeConfig('connections:\n  "mal nombre":\n    engine: mysql\n', {}), /nombre inválido/);
    assert.throws(() => parseEdgeConfig('otra: cosa\n', {}), /connections/);
  });

  it('expandEnv no reevalúa el contenido de las variables', () => {
    assert.equal(expandEnv('${A}', { A: '${B}', B: 'no' }, 'x'), '${B}');
  });
});

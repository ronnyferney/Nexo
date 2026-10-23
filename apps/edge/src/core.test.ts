import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertReadOnlySql, compileNamedParams, resolveLimits, SqlPolicyError } from './core/sql';

/** Verificación mínima de la copia del núcleo SQL (las pruebas completas viven en la API). */
describe('núcleo SQL compartido', () => {
  it('parámetros nombrados por motor', () => {
    const sql = "SELECT a::text, ':x' FROM t WHERE p = :p OR q = :p";
    assert.equal(compileNamedParams(sql, { p: 1 }, 'postgres').sql, "SELECT a::text, ':x' FROM t WHERE p = $1 OR q = $1");
    assert.equal(compileNamedParams(sql, { p: 1 }, 'mysql').sql, "SELECT a::text, ':x' FROM t WHERE p = ? OR q = ?");
    assert.equal(compileNamedParams(sql, { p: 1 }, 'mssql').sql, "SELECT a::text, ':x' FROM t WHERE p = @p1 OR q = @p1");
  });

  it('solo lectura y límites', () => {
    assert.throws(() => assertReadOnlySql('SELECT 1; DROP TABLE t', 'postgres'), SqlPolicyError);
    assert.throws(() => assertReadOnlySql('WITH d AS (DELETE FROM t RETURNING 1) SELECT 1', 'postgres'), SqlPolicyError);
    assert.deepEqual(resolveLimits({ maxRows: 1e9 }), { maxRows: 5000, timeoutMs: 15000 });
  });
});

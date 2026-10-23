import { suggestOperations } from './database.adapter';
import {
  assertAllowedTables,
  assertReadOnlySql,
  assertSingleStatement,
  buildSuggestedSelect,
  compileNamedParams,
  extractParamNames,
  extractTableRefs,
  resolveLimits,
  SqlPolicyError,
} from './core/sql';

describe('compileNamedParams', () => {
  const sql = 'SELECT * FROM vehiculos WHERE placa = :placa AND estado = :estado OR alterna = :placa';

  it('PostgreSQL: $n y reutiliza el índice de un parámetro repetido', () => {
    const q = compileNamedParams(sql, { placa: 'ABC123', estado: 'ACTIVO' }, 'postgres');
    expect(q.sql).toBe('SELECT * FROM vehiculos WHERE placa = $1 AND estado = $2 OR alterna = $1');
    expect(q.values).toEqual(['ABC123', 'ACTIVO']);
    expect(q.names).toEqual(['placa', 'estado']);
  });

  it('MySQL: un ? por aparición, con el valor repetido', () => {
    const q = compileNamedParams(sql, { placa: 'ABC123', estado: 'ACTIVO' }, 'mysql');
    expect(q.sql).toBe('SELECT * FROM vehiculos WHERE placa = ? AND estado = ? OR alterna = ?');
    expect(q.values).toEqual(['ABC123', 'ACTIVO', 'ABC123']);
  });

  it('SQL Server: @pN y reutiliza el índice', () => {
    const q = compileNamedParams(sql, { placa: 'ABC123', estado: 'ACTIVO' }, 'mssql');
    expect(q.sql).toBe('SELECT * FROM vehiculos WHERE placa = @p1 AND estado = @p2 OR alterna = @p1');
    expect(q.values).toEqual(['ABC123', 'ACTIVO']);
  });

  it('ignora ":" dentro de literales, comentarios e identificadores entrecomillados', () => {
    const q = compileNamedParams(
      `SELECT ':no' AS a, 'it''s :tampoco' AS b, "col:x" FROM t -- :comentario\nWHERE id = :id /* :otro */`,
      { id: 7 },
      'postgres',
    );
    expect(q.sql).toBe(
      `SELECT ':no' AS a, 'it''s :tampoco' AS b, "col:x" FROM t -- :comentario\nWHERE id = $1 /* :otro */`,
    );
    expect(q.values).toEqual([7]);
  });

  it('respeta los casts :: de PostgreSQL y el dollar quoting', () => {
    const q = compileNamedParams(
      `SELECT created_at::date, :fecha::timestamptz, $$ :x $$, $tag$ :y $tag$ FROM t WHERE a = :a`,
      { fecha: '2026-01-01', a: 1 },
      'postgres',
    );
    expect(q.sql).toBe(`SELECT created_at::date, $1::timestamptz, $$ :x $$, $tag$ :y $tag$ FROM t WHERE a = $2`);
    expect(q.values).toEqual(['2026-01-01', 1]);
  });

  it('MySQL: backticks, comentarios # y escapes con barra invertida', () => {
    const q = compileNamedParams("SELECT `a:b`, 'x\\':y' FROM t # :c\nWHERE id = :id", { id: 5 }, 'mysql');
    expect(q.sql).toBe("SELECT `a:b`, 'x\\':y' FROM t # :c\nWHERE id = ?");
    // Enteros como texto en MySQL (LIMIT ? con mysql2).
    expect(q.values).toEqual(['5']);
  });

  it('SQL Server: identificadores entre corchetes', () => {
    const q = compileNamedParams('SELECT [hora:minuto] FROM [dbo].[t] WHERE id = :id', { id: 1 }, 'mssql');
    expect(q.sql).toBe('SELECT [hora:minuto] FROM [dbo].[t] WHERE id = @p1');
  });

  it('el valor nunca se concatena: una inyección viaja como dato', () => {
    const evil = "x'; DROP TABLE vehiculos; --";
    const q = compileNamedParams('SELECT * FROM t WHERE placa = :placa', { placa: evil }, 'postgres');
    expect(q.sql).toBe('SELECT * FROM t WHERE placa = $1');
    expect(q.sql).not.toContain('DROP');
    expect(q.values).toEqual([evil]);
  });

  it('parámetros ausentes → NULL; objetos → JSON; listas solo en PostgreSQL', () => {
    expect(compileNamedParams('SELECT :a, :b', { b: { x: 1 } }, 'postgres').values).toEqual([null, '{"x":1}']);
    expect(compileNamedParams('SELECT 1 WHERE id = ANY(:ids)', { ids: [1, 2] }, 'postgres').values).toEqual([[1, 2]]);
    expect(() => compileNamedParams('SELECT :ids', { ids: [1] }, 'mysql')).toThrow(SqlPolicyError);
    expect(() => compileNamedParams('SELECT :n', { n: Infinity }, 'postgres')).toThrow(SqlPolicyError);
  });

  it('no confunde := ni sufijos de identificadores', () => {
    const q = compileNamedParams('SELECT a[1:2], x := 1, :ok', { ok: true }, 'postgres');
    expect(q.sql).toBe('SELECT a[1:2], x := 1, $1');
  });

  it('literal sin cerrar es un error', () => {
    expect(() => compileNamedParams("SELECT 'abc", {}, 'postgres')).toThrow(SqlPolicyError);
  });

  it('extractParamNames sin repetidos', () => {
    expect(extractParamNames(sql, 'postgres')).toEqual(['placa', 'estado']);
  });
});

describe('assertReadOnlySql', () => {
  const ok = (s: string, engine: 'postgres' | 'mysql' | 'mssql' = 'postgres') =>
    expect(() => assertReadOnlySql(s, engine)).not.toThrow();
  const bad = (s: string, engine: 'postgres' | 'mysql' | 'mssql' = 'postgres') =>
    expect(() => assertReadOnlySql(s, engine)).toThrow(SqlPolicyError);

  it('acepta SELECT, WITH y un único ; final', () => {
    ok('SELECT 1');
    ok('  select * from t where a = :a;  ');
    ok('WITH x AS (SELECT 1 AS a) SELECT * FROM x');
    ok('(SELECT 1) UNION (SELECT 2)');
    ok("SELECT 'DELETE FROM t; DROP TABLE x' AS texto");
    ok('SELECT updated_at, deleted FROM t -- DELETE');
    ok('SELECT "update" FROM t');
    ok('SELECT REPLACE(nombre, :a, :b) FROM t');
    ok('SELECT TOP (10) [delete] FROM [dbo].[t]', 'mssql');
  });

  it('rechaza escrituras', () => {
    bad('DELETE FROM vehiculos');
    bad('UPDATE t SET a = 1');
    bad('INSERT INTO t VALUES (1)');
    bad('DROP TABLE t');
    bad('TRUNCATE t');
  });

  it('rechaza sentencias encadenadas', () => {
    bad('SELECT 1; DROP TABLE vehiculos');
    bad('SELECT 1;; ');
    bad('SELECT 1; SELECT 2');
  });

  it('rechaza CTE con escritura y SELECT ... INTO', () => {
    bad('WITH borrados AS (DELETE FROM t RETURNING *) SELECT * FROM borrados');
    bad('WITH x AS (UPDATE t SET a = 1 RETURNING a) SELECT a FROM x');
    bad('SELECT * INTO copia FROM t');
    bad('SELECT * FROM t INTO OUTFILE "/tmp/x"', 'mysql');
  });

  it('rechaza funciones peligrosas conocidas y EXEC', () => {
    bad("SELECT pg_read_file('/etc/passwd')");
    bad("SELECT set_config('x', 'y', false)");
    bad('EXEC xp_cmdshell :cmd', 'mssql');
  });

  it('un comentario no oculta una segunda sentencia', () => {
    bad('SELECT 1 /* comentario */; DELETE FROM t');
    bad('SELECT 1 -- nada\n; DELETE FROM t');
  });

  it('rechaza consultas vacías', () => {
    bad('   ');
    bad('-- solo comentario');
  });
});

describe('assertSingleStatement (escrituras)', () => {
  it('permite una escritura y rechaza encadenar', () => {
    expect(() => assertSingleStatement('UPDATE t SET a = :a WHERE id = :id;', 'postgres')).not.toThrow();
    expect(() => assertSingleStatement('UPDATE t SET a = 1; DROP TABLE t', 'postgres')).toThrow(SqlPolicyError);
  });
});

describe('resolveLimits', () => {
  it('valores por defecto', () => {
    expect(resolveLimits({})).toEqual({ maxRows: 500, timeoutMs: 15_000 });
  });
  it('topes máximos y mínimos', () => {
    expect(resolveLimits({ maxRows: 100_000, timeoutMs: 600_000 })).toEqual({ maxRows: 5000, timeoutMs: 60_000 });
    expect(resolveLimits({ maxRows: 0, timeoutMs: 10 })).toEqual({ maxRows: 1, timeoutMs: 1000 });
    expect(resolveLimits({ maxRows: 'abc', timeoutMs: null })).toEqual({ maxRows: 500, timeoutMs: 15_000 });
  });
  it('aplica los topes locales (política del Edge)', () => {
    expect(resolveLimits({ maxRows: 2000, timeoutMs: 30_000 }, { maxRows: 100, timeoutMs: 5000 })).toEqual({
      maxRows: 100,
      timeoutMs: 5000,
    });
  });
});

describe('tablas permitidas', () => {
  it('extrae tablas de FROM/JOIN e ignora CTE y subconsultas', () => {
    const refs = extractTableRefs(
      'WITH r AS (SELECT * FROM ventas) SELECT * FROM r JOIN dbo.clientes c ON c.id = r.cid, "Inventario" i ' +
        'WHERE x IN (SELECT id FROM bodegas)',
      'postgres',
    );
    expect(refs.sort()).toEqual(['Inventario', 'bodegas', 'dbo.clientes', 'ventas']);
  });

  it('assertAllowedTables', () => {
    expect(() => assertAllowedTables('SELECT * FROM vehiculos v', 'postgres', ['vehiculos'])).not.toThrow();
    expect(() => assertAllowedTables('SELECT * FROM public.vehiculos', 'postgres', ['vehiculos'])).not.toThrow();
    expect(() => assertAllowedTables('SELECT * FROM nomina', 'postgres', ['vehiculos'])).toThrow(/nomina/);
    expect(() =>
      assertAllowedTables('SELECT * FROM vehiculos JOIN nomina ON true', 'postgres', ['public.vehiculos']),
    ).toThrow(/nomina/);
    expect(() => assertAllowedTables('SELECT * FROM cualquiera', 'postgres', [])).not.toThrow();
  });
});

describe('operaciones sugeridas', () => {
  const table = {
    schema: 'public',
    name: 'Vehículos 2026',
    type: 'TABLE' as const,
    columns: [
      { name: 'placa', type: 'text', nullable: false },
      { name: 'odd"col', type: 'int', nullable: true },
    ],
  };

  it('SELECT con columnas explícitas y límite por motor', () => {
    expect(buildSuggestedSelect('postgres', table)).toBe(
      'SELECT "placa", "odd""col" FROM "public"."Vehículos 2026" LIMIT :limit',
    );
    expect(buildSuggestedSelect('mysql', table)).toBe(
      'SELECT `placa`, `odd"col` FROM `public`.`Vehículos 2026` LIMIT :limit',
    );
    expect(buildSuggestedSelect('mssql', table)).toBe(
      'SELECT TOP (:limit) [placa], [odd"col] FROM [public].[Vehículos 2026]',
    );
  });

  it('claves select_<tabla> y SQL válido para solo lectura', () => {
    const ops = suggestOperations('postgres', [table, { ...table, schema: 'otro', name: 'clientes' }]);
    expect(ops.map((o) => o.key)).toEqual(['select_veh_culos_2026', 'select_clientes']);
    for (const op of ops) expect(() => assertReadOnlySql(String(op.definition.sql), 'postgres')).not.toThrow();
    expect(ops[0].definition).toMatchObject({ mode: 'read', maxRows: 500, defaults: { limit: 100 } });
  });

  it('desambigua con el esquema si dos tablas se llaman igual', () => {
    const ops = suggestOperations('postgres', [table, { ...table, schema: 'archivo' }]);
    expect(ops.map((o) => o.key)).toEqual(['select_public_veh_culos_2026', 'select_archivo_veh_culos_2026']);
  });
});

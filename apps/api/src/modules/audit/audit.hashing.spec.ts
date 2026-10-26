import { canonicalize, chainHashOf, contentHashOf, GENESIS_HASH, sha256, type AuditContent } from './audit.hashing';

describe('audit.hashing (E13)', () => {
  const base: AuditContent = {
    workspaceId: 'ws1',
    seq: 1,
    createdAt: '2026-10-26T00:00:00.000Z',
    actorType: 'USER',
    actorId: 'u1',
    action: 'APROBACION_CONCEDIDA',
    targetType: 'Aprobacion',
    targetId: 'a1',
    resumen: 'Aprobación concedida',
    metadata: { b: 2, a: 1 },
  };

  it('canonicaliza con claves ordenadas de forma recursiva (independiente del orden)', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ x: { d: 1, c: 2 } })).toBe(canonicalize({ x: { c: 2, d: 1 } }));
  });

  it('el contentHash es determinista y no depende del orden de metadata', () => {
    const h1 = contentHashOf(base);
    const h2 = contentHashOf({ ...base, metadata: { a: 1, b: 2 } });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cualquier cambio de contenido cambia el contentHash', () => {
    const h = contentHashOf(base);
    expect(contentHashOf({ ...base, resumen: 'otro' })).not.toBe(h);
    expect(contentHashOf({ ...base, seq: 2 })).not.toBe(h);
    expect(contentHashOf({ ...base, metadata: { a: 1, b: 3 } })).not.toBe(h);
  });

  it('chainHashOf enlaza contentHash + prevHash + seq', () => {
    const c = contentHashOf(base);
    const link = chainHashOf(c, GENESIS_HASH, 1);
    expect(link).toBe(sha256(`${c}|${GENESIS_HASH}|1`));
    // Cambiar el eslabón anterior cambia el hash (encadenamiento).
    expect(chainHashOf(c, 'deadbeef', 1)).not.toBe(link);
    expect(chainHashOf(c, GENESIS_HASH, 2)).not.toBe(link);
  });

  it('GENESIS_HASH son 64 ceros', () => {
    expect(GENESIS_HASH).toBe('0'.repeat(64));
  });
});

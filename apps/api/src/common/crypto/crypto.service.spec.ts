import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes } from 'node:crypto';
import { CipherContexts } from './cipher-context';
import { CryptoService, DecryptionError } from './crypto.service';
import { rotateCiphertexts, type RotationRow, type RotationTarget } from './crypto-rotation';
import { parseKeyring } from './keyring';

const LEGACY = '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff';
const K1 = '6b1f9e2c4a7d3e8f0c5b9a1d2e4f6a8c7b3d5e9f1a2c4e6b8d0f3a5c7e9b1d2f';
const K2 = '9c2e4b6a8d0f1e3c5a7b9d2f4e6c8a0b1d3f5e7c9a2b4d6f8e0c1a3b5d7f9e2c';

/** Servicio con el anillo que resulta de estas variables (igual que la API). */
const service = (env: Record<string, string>) => {
  const { keyring, errors } = parseKeyring(env);
  if (!keyring) throw new Error(errors.join('; '));
  return new CryptoService(new ConfigService({ encryption: keyring }));
};

/** Valor en el formato anterior a B7: base64(iv | tag | datos) sin AAD. */
function legacyEncrypt(plain: string, hex = LEGACY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

const SECRET = CipherContexts.secret('ws1', 'HUBSPOT_TOKEN');

describe('CryptoService · formato v2 con kid y AAD (B7)', () => {
  it('cifra en v2 con el kid activo y descifra con el mismo contexto', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY });
    const payload = crypto.encrypt('pat-123', SECRET);
    expect(payload).toMatch(/^v2:k0:[A-Za-z0-9+/]+=*$/);
    expect(payload).not.toContain('pat-123');
    expect(crypto.decrypt(payload, SECRET)).toBe('pat-123');
    expect(crypto.encrypt('pat-123', SECRET)).not.toBe(payload); // IV aleatorio
  });

  it('el compat de pruebas (solo encryptionKey) equivale a ENCRYPTION_KEY', () => {
    const a = new CryptoService(new ConfigService({ encryptionKey: LEGACY }));
    const b = service({ ENCRYPTION_KEY: LEGACY });
    expect(b.decrypt(a.encrypt('x', SECRET), SECRET)).toBe('x');
  });

  it('un contexto distinto (otro workspace, otro campo, otro nombre) no descifra', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY });
    const payload = crypto.encrypt('pat-123', SECRET);
    for (const other of [
      CipherContexts.secret('ws2', 'HUBSPOT_TOKEN'),
      CipherContexts.secret('ws1', 'OTRO'),
      CipherContexts.llmApiKey('ws1'),
      CipherContexts.oauthAccess('ws1', 'HUBSPOT_TOKEN'),
    ]) {
      expect(() => crypto.decrypt(payload, other)).toThrow(DecryptionError);
    }
  });

  it('el contexto es canónico: separadores dentro de un nombre no permiten colisiones', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY });
    const payload = crypto.encrypt('v', CipherContexts.oauthStateVerifier('ws', 'u1', 'j:x'));
    expect(() => crypto.decrypt(payload, CipherContexts.oauthStateVerifier('ws', 'u1:j', 'x'))).toThrow(
      DecryptionError,
    );
  });

  it('detecta datos alterados, kid manipulado y valores truncados', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k1' });
    const payload = crypto.encrypt('pat-123', SECRET);
    const raw = Buffer.from(payload.slice('v2:k1:'.length), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => crypto.decrypt(`v2:k1:${raw.toString('base64')}`, SECRET)).toThrow(DecryptionError);
    // Cambiar el kid del prefijo a otra clave conocida no sirve (el kid también va en el AAD y la clave difiere).
    expect(() => crypto.decrypt(payload.replace('v2:k1:', 'v2:k0:'), SECRET)).toThrow(DecryptionError);
    expect(() => crypto.decrypt('v2:k1:AAAA', SECRET)).toThrow(/truncado/);
    expect(() => crypto.decrypt('v2:desconocido:AAAA', SECRET)).toThrow(/no está configurada/);
    expect(() => crypto.decrypt('v3:k1:AAAA', SECRET)).toThrow(/versión de formato desconocida/);
    expect(() => crypto.decrypt('', SECRET)).toThrow(DecryptionError);
  });

  it('el mensaje de error nunca incluye el valor ni la clave', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY });
    const payload = crypto.encrypt('pat-super-secreto', SECRET);
    try {
      crypto.decrypt(payload, CipherContexts.llmApiKey('ws1'));
      throw new Error('debía fallar');
    } catch (err) {
      expect((err as Error).message).not.toContain('pat-super-secreto');
      expect((err as Error).message).not.toContain(LEGACY);
      expect((err as Error).message).not.toContain(payload);
    }
  });
});

describe('CryptoService · lectura legacy y varias claves (B7)', () => {
  it('lee el formato anterior sin AAD con ENCRYPTION_KEY, con cualquier contexto', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k1' });
    const old = legacyEncrypt('token-viejo');
    expect(crypto.decrypt(old, SECRET)).toBe('token-viejo');
    expect(crypto.decrypt(old, CipherContexts.llmApiKey('otro'))).toBe('token-viejo');
    expect(crypto.needsRotation(old)).toBe(true);
    expect(CryptoService.kidOf(old)).toBe('k0');
  });

  it('un valor legacy alterado o de otra clave falla', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY });
    expect(() => crypto.decrypt(legacyEncrypt('x', K2), SECRET)).toThrow(DecryptionError);
  });

  it('ENCRYPTION_LEGACY_READS=false rechaza el formato anterior y sigue leyendo v2:k0', () => {
    const before = service({ ENCRYPTION_KEY: LEGACY });
    const v2k0 = before.encrypt('nuevo', SECRET);
    const crypto = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_LEGACY_READS: 'false' });
    expect(() => crypto.decrypt(legacyEncrypt('viejo'), SECRET)).toThrow(/lecturas legacy desactivadas/);
    expect(crypto.decrypt(v2k0, SECRET)).toBe('nuevo');
  });

  it('sin ENCRYPTION_KEY el formato legacy no se puede leer', () => {
    const crypto = service({ ENCRYPTION_KEYS: `k1:${K1}` });
    expect(crypto.currentKid).toBe('k1');
    expect(() => crypto.decrypt(legacyEncrypt('x'), SECRET)).toThrow(/legacy/);
  });

  it('convive con varias claves: cifra con la activa y descifra con cualquiera', () => {
    const phase1 = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k1' });
    const byK1 = phase1.encrypt('a', SECRET);
    const phase2 = service({
      ENCRYPTION_KEY: LEGACY,
      ENCRYPTION_KEYS: `k1:${K1},k2:${K2}`,
      ENCRYPTION_ACTIVE_KID: 'k2',
    });
    const byK2 = phase2.encrypt('b', SECRET);
    expect(byK2.startsWith('v2:k2:')).toBe(true);
    expect(phase2.decrypt(byK1, SECRET)).toBe('a');
    expect(phase2.needsRotation(byK1)).toBe(true);
    expect(phase2.needsRotation(byK2)).toBe(false);
    // Una réplica que todavía no conoce k2 falla de forma explícita (por eso se despliega antes de activarla).
    expect(() => phase1.decrypt(byK2, SECRET)).toThrow(/la clave k2 no está configurada/);
  });

  it('reencrypt devuelve el mismo valor si ya usa la clave activa y si no lo re-cifra', () => {
    const crypto = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k1' });
    const current = crypto.encrypt('x', SECRET);
    expect(crypto.reencrypt(current, SECRET)).toBe(current);
    const rotated = crypto.reencrypt(legacyEncrypt('x'), SECRET);
    expect(rotated.startsWith('v2:k1:')).toBe(true);
    expect(crypto.decrypt(rotated, SECRET)).toBe('x');
    expect(() => crypto.reencrypt(crypto.encrypt('x', SECRET).replace('v2:k1:', 'v2:k0:'), SECRET)).toThrow();
  });
});

describe('rotateCiphertexts · crypto:rotate (B7)', () => {
  /** Tabla en memoria con el mismo contrato que `rotationTargets` (filtro por prefijo, orden por id, update condicional). */
  const table = (rows: RotationRow[], onUpdate?: (id: string) => void) => {
    const data = new Map(rows.map((r) => [r.id, { ...r }]));
    const target: RotationTarget = {
      name: 'Prueba.campo',
      fetch: (afterId, take, prefix) =>
        Promise.resolve(
          [...data.values()]
            .filter((r) => (!afterId || r.id > afterId) && !r.cipher.startsWith(prefix))
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, take)
            .map((r) => ({ ...r })),
        ),
      update: (id, from, to) => {
        onUpdate?.(id);
        const row = data.get(id)!;
        if (row.cipher !== from) return Promise.resolve(0);
        row.cipher = to;
        return Promise.resolve(1);
      },
    };
    return { target, data };
  };

  const crypto = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1},k2:${K2}`, ENCRYPTION_ACTIVE_KID: 'k2' });
  const k1 = service({ ENCRYPTION_KEY: LEGACY, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k1' });
  const ctx = (i: number) => CipherContexts.secret('ws1', `S${i}`);

  it('re-cifra por lotes legacy y claves anteriores con la activa, y es idempotente', async () => {
    const rows: RotationRow[] = [];
    for (let i = 0; i < 25; i++) {
      const cipher = i % 3 === 0 ? legacyEncrypt(`v${i}`) : i % 3 === 1 ? k1.encrypt(`v${i}`, ctx(i)) : '';
      rows.push({
        id: `r${String(i).padStart(2, '0')}`,
        cipher: cipher || crypto.encrypt(`v${i}`, ctx(i)),
        context: ctx(i),
      });
    }
    const { target, data } = table(rows);
    const untouched = rows.filter((r) => r.cipher.startsWith('v2:k2:')).map((r) => r.cipher);

    const dry = await rotateCiphertexts(crypto, [target], { batchSize: 4, dryRun: true });
    expect(dry[0]).toMatchObject({ scanned: 17, rotated: 17, failed: 0 });
    expect([...data.values()].filter((r) => !r.cipher.startsWith('v2:k2:'))).toHaveLength(17);

    const [stats] = await rotateCiphertexts(crypto, [target], { batchSize: 4 });
    expect(stats).toMatchObject({ target: 'Prueba.campo', scanned: 17, rotated: 17, skipped: 0, failed: 0 });
    for (const [i, row] of [...data.values()].entries()) {
      expect(row.cipher.startsWith('v2:k2:')).toBe(true);
      expect(crypto.decrypt(row.cipher, ctx(i))).toBe(`v${i}`);
    }
    // Los que ya usaban la clave activa no se reescriben.
    for (const c of untouched) expect([...data.values()].some((r) => r.cipher === c)).toBe(true);

    const [again] = await rotateCiphertexts(crypto, [target], { batchSize: 4 });
    expect(again).toMatchObject({ scanned: 0, rotated: 0 });
  });

  it('informa sin modificar los valores que no descifra y no pisa las escrituras concurrentes de la API', async () => {
    const foreign = service({ ENCRYPTION_KEYS: `kx:${randomBytes(32).toString('hex')}` });
    const rows: RotationRow[] = [
      { id: 'a', cipher: legacyEncrypt('ok'), context: ctx(1) },
      { id: 'b', cipher: k1.encrypt('contexto-equivocado', ctx(99)), context: ctx(2) },
      { id: 'c', cipher: foreign.encrypt('otra-clave', ctx(3)), context: ctx(3) },
      { id: 'd', cipher: legacyEncrypt('carrera'), context: ctx(4) },
    ];
    const { target, data } = table(rows, (id) => {
      // La API renueva el token de `d` entre la lectura y la escritura de la rotación.
      if (id === 'd') data.get('d')!.cipher = crypto.encrypt('nuevo-de-la-api', ctx(4));
    });
    const [stats] = await rotateCiphertexts(crypto, [target]);
    expect(stats).toMatchObject({ scanned: 4, rotated: 1, skipped: 1, failed: 2, failedIds: ['b', 'c'] });
    expect(data.get('b')!.cipher).toBe(rows[1].cipher);
    expect(data.get('c')!.cipher).toBe(rows[2].cipher);
    expect(crypto.decrypt(data.get('d')!.cipher, ctx(4))).toBe('nuevo-de-la-api');
  });
});

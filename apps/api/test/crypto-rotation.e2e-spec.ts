import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes } from 'node:crypto';
import { CipherContexts } from '../src/common/crypto/cipher-context';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { rotateCiphertexts, rotationTargets } from '../src/common/crypto/crypto-rotation';
import { parseKeyring } from '../src/common/crypto/keyring';
import { SecretsService } from '../src/modules/workspaces/secrets.service';
import { createTestApp, prismaOf } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

/** Clave de la suite (`test/setup-env.ts`): la `ENCRYPTION_KEY` legacy, kid `k0`. */
const LEGACY_KEY = process.env.ENCRYPTION_KEY!;
const NEW_KEY = randomBytes(32).toString('hex');

/** Valor cifrado como lo hacía Nexo antes de B7: base64(iv | tag | datos), sin prefijo ni AAD. */
function legacyEncrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(LEGACY_KEY, 'hex'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Altera un byte del IV: GCM lo detecta. */
function tamper(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  raw[0] ^= 0xff;
  return raw.toString('base64');
}

const cryptoWith = (env: Record<string, string>) =>
  new CryptoService(new ConfigService({ encryption: parseKeyring(env).keyring }));

/**
 * B7: datos guardados en el formato anterior siguen leyéndose; `crypto:rotate` los re-cifra (v2 + AAD) con la clave
 * activa por lotes, de forma idempotente, y un valor movido a otra fila deja de descifrarse.
 */
describe('Cifrado versionado y rotación de claves (E2E, B7)', () => {
  let app: INestApplication;
  let owner: Session;
  let connectorId: string;
  let llmId: string;
  let otherWorkspaceId: string;
  /** Flujos de dispositivo: esperando autorización, por confirmar y por confirmar con el formato previo a pendingCipher. */
  const flows: Record<'pending' | 'confirm' | 'legacyConfirm', string> = {
    pending: '',
    confirm: '',
    legacyConfirm: '',
  };

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'rotacion');
    const prisma = prismaOf(app);
    const ws = owner.workspaceId;
    // Filas "antiguas": cifradas antes de B7.
    for (let i = 0; i < 7; i++) {
      await prisma.secret.create({
        data: { workspaceId: ws, name: `LEGACY_${i}`, ciphertext: legacyEncrypt(`v-${i}`) },
      });
    }
    const connector = await prisma.connector.create({
      data: { workspaceId: ws, name: 'CRM', type: 'REST', auth: { type: 'oauth2_code' } },
    });
    connectorId = connector.id;
    await prisma.oAuthCredential.create({
      data: {
        connectorId,
        accessTokenCipher: legacyEncrypt('at-legacy'),
        refreshTokenCipher: legacyEncrypt('rt-legacy'),
      },
    });
    const llm = await prisma.llmConnection.create({
      data: {
        workspaceId: ws,
        name: 'OpenAI',
        kind: 'OPENAI_COMPATIBLE',
        apiKeyCipher: legacyEncrypt('sk-legacy'),
        oauthRefreshCipher: legacyEncrypt('rt-llm-legacy'),
      },
    });
    llmId = llm.id;
    const crypto = app.get(CryptoService);
    const flow = (status: string, data: { deviceCodeCipher?: string; pendingCipher?: string }) =>
      prisma.llmAuthFlow.create({
        data: {
          workspaceId: ws,
          userId: owner.userId,
          type: 'DEVICE_CODE',
          providerId: 'huggingface',
          status,
          expiresAt: new Date(Date.now() + 600_000),
          ...data,
        },
      });
    const deviceCtx = CipherContexts.llmDeviceCode(ws, owner.userId);
    const tokensCtx = CipherContexts.llmPendingTokens(ws, owner.userId);
    flows.pending = (await flow('pending', { deviceCodeCipher: crypto.encrypt('dc-1', deviceCtx) })).id;
    flows.confirm = (await flow('confirm', { pendingCipher: crypto.encrypt('{"t":"nuevo"}', tokensCtx) })).id;
    flows.legacyConfirm = (await flow('confirm', { deviceCodeCipher: crypto.encrypt('{"t":"previo"}', tokensCtx) })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('la API lee los valores legacy y escribe los nuevos en v2 con AAD', async () => {
    const secrets = app.get(SecretsService);
    const values = await secrets.resolveAll(owner.workspaceId);
    expect(values).toMatchObject({ LEGACY_0: 'v-0', LEGACY_6: 'v-6' });

    await owner.api.put('/workspace/secrets', { name: 'NUEVO', value: 'valor-nuevo' }).expect(200);
    const row = await prismaOf(app).secret.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, name: 'NUEVO' },
    });
    expect(row.ciphertext).toMatch(/^v2:k0:/);
    expect(await secrets.resolveMany(owner.workspaceId, ['NUEVO'])).toEqual({ NUEVO: 'valor-nuevo' });
  });

  it('un valor v2 copiado a otra fila u otro workspace no se descifra (AAD)', async () => {
    const prisma = prismaOf(app);
    const source = await prisma.secret.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, name: 'NUEVO' } });
    const other = await registerOwner(app, 'rotacion-otro');
    otherWorkspaceId = other.workspaceId;
    await prisma.secret.create({
      data: { workspaceId: owner.workspaceId, name: 'COPIA', ciphertext: source.ciphertext },
    });
    await prisma.secret.create({
      data: { workspaceId: other.workspaceId, name: 'NUEVO', ciphertext: source.ciphertext },
    });
    const secrets = app.get(SecretsService);
    await expect(secrets.resolveMany(owner.workspaceId, ['COPIA'])).rejects.toThrow(/No se pudo descifrar/);
    await expect(secrets.resolveMany(other.workspaceId, ['NUEVO'])).rejects.toThrow(/No se pudo descifrar/);
    await prisma.secret.deleteMany({ where: { workspaceId: owner.workspaceId, name: 'COPIA' } });
  });

  it('crypto:rotate re-cifra por lotes con la clave activa, informa lo que no descifra y es idempotente', async () => {
    const prisma = prismaOf(app);
    const rotated = cryptoWith({
      ENCRYPTION_KEY: LEGACY_KEY,
      ENCRYPTION_KEYS: `k1:${NEW_KEY}`,
      ENCRYPTION_ACTIVE_KID: 'k1',
    });
    // Un valor dañado: se informa y no se toca.
    const broken = await prisma.secret.create({
      data: { workspaceId: owner.workspaceId, name: 'DANADO', ciphertext: tamper(legacyEncrypt('x')) },
    });
    const targets = rotationTargets(prisma, { workspaceId: owner.workspaceId });

    const dry = await rotateCiphertexts(rotated, targets, { batchSize: 3, dryRun: true });
    const by = (stats: typeof dry, name: string) => stats.find((s) => s.target === name)!;
    expect(by(dry, 'Secret.ciphertext')).toMatchObject({ rotated: 8, failed: 1 });
    expect((await prisma.secret.findUniqueOrThrow({ where: { id: broken.id } })).ciphertext).not.toMatch(/^v2:/);

    const lines: string[] = [];
    const stats = await rotateCiphertexts(rotated, targets, { batchSize: 3, log: (l) => lines.push(l) });
    expect(by(stats, 'Secret.ciphertext')).toMatchObject({ rotated: 8, failed: 1, failedIds: [broken.id] });
    expect(by(stats, 'OAuthCredential.accessTokenCipher')).toMatchObject({ rotated: 1, failed: 0 });
    expect(by(stats, 'OAuthCredential.refreshTokenCipher')).toMatchObject({ rotated: 1, failed: 0 });
    expect(by(stats, 'LlmConnection.apiKeyCipher')).toMatchObject({ rotated: 1, failed: 0 });
    expect(by(stats, 'LlmConnection.oauthRefreshCipher')).toMatchObject({ rotated: 1, failed: 0 });
    // Cada columna de LlmAuthFlow con su contexto; deviceCodeCipher aún admite los tokens del formato previo.
    expect(by(stats, 'LlmAuthFlow.deviceCodeCipher')).toMatchObject({ rotated: 2, failed: 0 });
    expect(by(stats, 'LlmAuthFlow.pendingCipher')).toMatchObject({ rotated: 1, failed: 0 });
    // El informe nunca incluye valores.
    expect(lines.join('\n')).not.toMatch(/v-\d|legacy|sk-/);

    const ws = owner.workspaceId;
    const secretRows = await prisma.secret.findMany({ where: { workspaceId: ws, NOT: { id: broken.id } } });
    expect(secretRows.every((r) => r.ciphertext.startsWith('v2:k1:'))).toBe(true);
    const reader = new SecretsService(prisma, rotated);
    expect(await reader.resolveMany(ws, ['LEGACY_3', 'NUEVO'])).toEqual({ LEGACY_3: 'v-3', NUEVO: 'valor-nuevo' });
    const cred = await prisma.oAuthCredential.findUniqueOrThrow({ where: { connectorId } });
    expect(rotated.decrypt(cred.accessTokenCipher, CipherContexts.oauthAccess(ws, connectorId))).toBe('at-legacy');
    expect(rotated.decrypt(cred.refreshTokenCipher!, CipherContexts.oauthRefresh(ws, connectorId))).toBe('rt-legacy');
    const llm = await prisma.llmConnection.findUniqueOrThrow({ where: { id: llmId } });
    expect(rotated.decrypt(llm.apiKeyCipher!, CipherContexts.llmApiKey(ws))).toBe('sk-legacy');
    expect(rotated.decrypt(llm.oauthRefreshCipher!, CipherContexts.llmRefresh(ws))).toBe('rt-llm-legacy');
    const flowRow = (id: string) => prisma.llmAuthFlow.findUniqueOrThrow({ where: { id } });
    const deviceCtx = CipherContexts.llmDeviceCode(ws, owner.userId);
    const tokensCtx = CipherContexts.llmPendingTokens(ws, owner.userId);
    const [pending, confirm, legacyConfirm] = await Promise.all(
      [flows.pending, flows.confirm, flows.legacyConfirm].map(flowRow),
    );
    expect(pending.deviceCodeCipher).toMatch(/^v2:k1:/);
    expect(rotated.decrypt(pending.deviceCodeCipher!, deviceCtx)).toBe('dc-1');
    expect(confirm.pendingCipher).toMatch(/^v2:k1:/);
    expect(rotated.decrypt(confirm.pendingCipher!, tokensCtx)).toBe('{"t":"nuevo"}');
    expect(legacyConfirm.deviceCodeCipher).toMatch(/^v2:k1:/);
    expect(rotated.decrypt(legacyConfirm.deviceCodeCipher!, tokensCtx)).toBe('{"t":"previo"}');

    // Segunda ejecución: nada pendiente salvo el valor dañado.
    const again = await rotateCiphertexts(rotated, targets, { batchSize: 3 });
    expect(again.reduce((n, s) => n + s.rotated, 0)).toBe(0);
    expect(by(again, 'Secret.ciphertext')).toMatchObject({ scanned: 1, failed: 1 });

    // Sin la clave k1 (una réplica sin desplegar) los valores rotados no se leen: por eso se despliega antes de activar.
    await expect(app.get(SecretsService).resolveMany(ws, ['LEGACY_3'])).rejects.toThrow(
      /la clave k1 no está configurada/,
    );
    // Otro workspace no se tocó (su copia sigue con la clave k0).
    const untouched = await prisma.secret.findFirstOrThrow({ where: { workspaceId: otherWorkspaceId, name: 'NUEVO' } });
    expect(untouched.ciphertext).toMatch(/^v2:k0:/);
  });
});

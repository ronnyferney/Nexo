import { Logger } from '@nestjs/common';
import { oauthAppIssues, secretWeaknesses, validateEnv } from './env.validation';

const STRONG_JWT = 'f3a9c1d27be84f6a90c5e1b2d7a4c8e9b1f0a3d5c7e9f2b4a6c8d0e1f3a5b7c9';
const STRONG_KEY = '6b1f9e2c4a7d3e8f0c5b9a1d2e4f6a8c7b3d5e9f1a2c4e6b8d0f3a5c7e9b1d2f';

const env = (over: Record<string, unknown> = {}) => ({
  DATABASE_URL: 'postgresql://nexo:nexo@localhost:5432/nexo',
  JWT_SECRET: STRONG_JWT,
  ENCRYPTION_KEY: STRONG_KEY,
  ...over,
});

describe('validateEnv · secretos débiles (M9)', () => {
  let warn: jest.SpiedFunction<Logger['warn']>;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('acepta secretos aleatorios en producción', () => {
    expect(() => validateEnv(env({ NODE_ENV: 'production' }))).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'el JWT_SECRET de .env.example',
      { JWT_SECRET: 'cambie-este-secreto-por-uno-de-al-menos-32-caracteres' },
      /JWT_SECRET es un valor de ejemplo/,
    ],
    [
      'la ENCRYPTION_KEY en ceros de .env.example',
      { ENCRYPTION_KEY: '0'.repeat(64) },
      /ENCRYPTION_KEY es un valor de ejemplo/,
    ],
    [
      'un JWT_SECRET de un solo carácter repetido',
      { JWT_SECRET: 'a'.repeat(48) },
      /JWT_SECRET tiene muy baja entropía/,
    ],
    [
      'un JWT_SECRET con un patrón repetido',
      { JWT_SECRET: 'nexo1234'.repeat(5) },
      /JWT_SECRET tiene muy baja entropía/,
    ],
    [
      'una ENCRYPTION_KEY con un patrón repetido',
      { ENCRYPTION_KEY: '0123456789abcdef'.repeat(4) },
      /ENCRYPTION_KEY tiene muy baja entropía/,
    ],
    [
      'una ENCRYPTION_KEY con pocos dígitos distintos',
      { ENCRYPTION_KEY: 'ab'.repeat(31) + 'ba' },
      /ENCRYPTION_KEY tiene muy baja entropía/,
    ],
    [
      'una ENCRYPTION_KEY casi en ceros',
      { ENCRYPTION_KEY: '0'.repeat(63) + '1' },
      /ENCRYPTION_KEY tiene muy baja entropía/,
    ],
    ['el mismo valor en ambos secretos', { JWT_SECRET: STRONG_KEY.toUpperCase() }, /no pueden ser el mismo valor/],
  ])('en producción rechaza %s', (_case, over, message) => {
    expect(() => validateEnv(env({ ...over, NODE_ENV: 'production' }))).toThrow(message);
  });

  it('en desarrollo y pruebas solo advierte (los valores de .env.example siguen arrancando)', () => {
    const example = env({
      JWT_SECRET: 'cambie-este-secreto-por-uno-de-al-menos-32-caracteres',
      ENCRYPTION_KEY: '0'.repeat(64),
    });
    for (const NODE_ENV of ['development', 'test', undefined]) {
      warn.mockClear();
      expect(validateEnv({ ...example, NODE_ENV })).toMatchObject({ JWT_SECRET: example.JWT_SECRET });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toMatch(/se rechazará con NODE_ENV=production/);
    }
  });

  it('valores aleatorios generados con openssl (hex 16 y 32) nunca se marcan como débiles', () => {
    const { randomBytes } = jest.requireActual<typeof import('node:crypto')>('node:crypto');
    for (let i = 0; i < 2000; i++) {
      const issues = secretWeaknesses({
        JWT_SECRET: randomBytes(16 + (i % 2) * 16).toString('hex'),
        ENCRYPTION_KEY: i % 2 ? randomBytes(32).toString('hex') : randomBytes(32).toString('hex').toUpperCase(),
      });
      expect(issues).toEqual([]);
    }
  });

  it('valida el formato de TRUST_PROXY y SWAGGER_ENABLED', () => {
    expect(() => validateEnv(env({ TRUST_PROXY: 'loopback, 10.0.0.0/8, fd00::/8' }))).not.toThrow();
    expect(() => validateEnv(env({ TRUST_PROXY: '2' }))).not.toThrow();
    expect(() => validateEnv(env({ TRUST_PROXY: 'todos' }))).toThrow(/TRUST_PROXY no reconoce "todos"/);
    expect(() => validateEnv(env({ SWAGGER_ENABLED: 'si' }))).toThrow(/SWAGGER_ENABLED/);
  });

  it('valida REGISTRATION_MODE y exige MAIL_FROM con SMTP_URL (C1)', () => {
    expect(() => validateEnv(env({ REGISTRATION_MODE: 'invite_only' }))).not.toThrow();
    expect(() => validateEnv(env({ REGISTRATION_MODE: 'abierto' }))).toThrow(/REGISTRATION_MODE/);
    expect(() => validateEnv(env({ SMTP_URL: 'smtp://localhost:25' }))).toThrow(/MAIL_FROM es obligatorio/);
    expect(() => validateEnv(env({ SMTP_URL: 'smtp://localhost:25', MAIL_FROM: 'Nexo <no@nexo.co>' }))).not.toThrow();
    expect(() => validateEnv(env({ SMTP_URL: 'http://correo', MAIL_FROM: 'x@nexo.co' }))).toThrow(/SMTP_URL/);
  });
});

describe('validateEnv · anillo de claves de cifrado (B7)', () => {
  const K1 = '9c2e4b6a8d0f1e3c5a7b9d2f4e6c8a0b1d3f5e7c9a2b4d6f8e0c1a3b5d7f9e2c';
  const K2 = '41d7a9c3e5f7b1d3a5c7e9f2b4d6a8c0e1f3b5d7a9c2e4f6b8d0a1c3e5f7b9d2';
  let warn: jest.SpiedFunction<Logger['warn']>;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('acepta ENCRYPTION_KEY sola, con claves adicionales y kid activo, o solo ENCRYPTION_KEYS', () => {
    const prod = { NODE_ENV: 'production' };
    expect(() => validateEnv(env(prod))).not.toThrow();
    expect(() =>
      validateEnv(env({ ...prod, ENCRYPTION_KEYS: `k2026a:${K1}, k2026b:${K2}`, ENCRYPTION_ACTIVE_KID: 'k2026b' })),
    ).not.toThrow();
    expect(() => validateEnv(env({ ...prod, ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k0' }))).not.toThrow();
    expect(() => validateEnv(env({ ...prod, ENCRYPTION_KEY: undefined, ENCRYPTION_KEYS: `k1:${K1}` }))).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['sin ninguna clave', { ENCRYPTION_KEY: undefined }, /Defina ENCRYPTION_KEY/],
    ['ENCRYPTION_KEY sin formato hexadecimal', { ENCRYPTION_KEY: 'corta' }, /ENCRYPTION_KEY debe ser 32 bytes/],
    ['varias claves sin kid activo', { ENCRYPTION_KEYS: `k1:${K1}` }, /Defina ENCRYPTION_ACTIVE_KID/],
    ['un kid activo inexistente', { ENCRYPTION_KEYS: `k1:${K1}`, ENCRYPTION_ACTIVE_KID: 'k9' }, /no corresponde/],
    ['el kid reservado k0', { ENCRYPTION_KEYS: `k0:${K1}`, ENCRYPTION_ACTIVE_KID: 'k0' }, /reservado/],
    [
      'un kid repetido',
      { ENCRYPTION_KEYS: `k1:${K1},k1:${K2}`, ENCRYPTION_ACTIVE_KID: 'k1' },
      /el kid k1 está repetido/,
    ],
    ['un kid inválido', { ENCRYPTION_KEYS: `clave nueva:${K1}`, ENCRYPTION_ACTIVE_KID: 'k0' }, /kid:clave/],
    ['una clave no hexadecimal', { ENCRYPTION_KEYS: 'k1:xyz', ENCRYPTION_ACTIVE_KID: 'k1' }, /la clave k1 debe ser/],
    [
      'dos kid con la misma clave',
      { ENCRYPTION_KEYS: `k1:${K1},k2:${K1.toUpperCase()}`, ENCRYPTION_ACTIVE_KID: 'k1' },
      /misma clave/,
    ],
    ['ENCRYPTION_LEGACY_READS inválido', { ENCRYPTION_LEGACY_READS: 'no' }, /ENCRYPTION_LEGACY_READS/],
  ])('rechaza %s (en cualquier entorno)', (_case, over, message) => {
    expect(() => validateEnv(env(over))).toThrow(message);
  });

  it.each([
    ['una clave de ejemplo en ceros', `k1:${'0'.repeat(64)}`, /ENCRYPTION_KEYS \(k1\) es un valor de ejemplo/],
    [
      'una clave de baja entropía',
      `k1:${'0123456789abcdef'.repeat(4)}`,
      /ENCRYPTION_KEYS \(k1\) tiene muy baja entropía/,
    ],
    ['una clave igual a JWT_SECRET', `k1:${STRONG_JWT}`, /JWT_SECRET y ENCRYPTION_KEYS \(k1\) no pueden ser el mismo/],
  ])('en producción rechaza en ENCRYPTION_KEYS %s', (_case, keys, message) => {
    expect(() =>
      validateEnv(env({ NODE_ENV: 'production', ENCRYPTION_KEYS: keys, ENCRYPTION_ACTIVE_KID: 'k1' })),
    ).toThrow(message);
  });
});

describe('validateEnv · apps OAuth de la plataforma', () => {
  const ID = 'caacab14-22dc-4276-a00d-abf0d650e5a6';

  it('acepta una app de Microsoft con el Id. de aplicación y el Valor del secreto', () => {
    expect(
      oauthAppIssues({ OAUTH_MICROSOFT_CLIENT_ID: ID, OAUTH_MICROSOFT_CLIENT_SECRET: 'abc8Q~valor.del_secreto' }),
    ).toEqual([]);
    expect(oauthAppIssues({ OAUTH_MICROSOFT_CLIENT_ID: '', OAUTH_MICROSOFT_CLIENT_SECRET: '' })).toEqual([]);
  });

  // Regresión: el "Id. de secreto" (GUID) pegado en lugar del Valor solo fallaba en la pantalla de Microsoft.
  it('detecta el Id. de secreto en lugar del Valor, un client ID que no es GUID y valores repetidos', () => {
    const secretId = oauthAppIssues({
      OAUTH_MICROSOFT_CLIENT_ID: ID,
      OAUTH_MICROSOFT_CLIENT_SECRET: 'd9f3e1dc-f7ed-4ea3-8ac8-72b2c6680000',
    });
    expect(secretId.join(' ')).toMatch(/parece el "Id. de secreto"/);
    expect(
      oauthAppIssues({ OAUTH_MICROSOFT_CLIENT_ID: 'Nexo', OAUTH_MICROSOFT_CLIENT_SECRET: 'abc8Q~valor' }).join(' '),
    ).toMatch(/Id. de aplicación \(cliente\)/);
    expect(oauthAppIssues({ OAUTH_MICROSOFT_CLIENT_ID: ID, OAUTH_MICROSOFT_CLIENT_SECRET: ID }).join(' ')).toMatch(
      /mismo valor/,
    );
  });

  it('exige el ID y el secreto juntos para cualquier proveedor', () => {
    expect(oauthAppIssues({ OAUTH_GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' })).toEqual([
      'OAUTH_GOOGLE_CLIENT_ID y OAUTH_GOOGLE_CLIENT_SECRET se definen juntos (falta el secreto)',
    ]);
    expect(() => validateEnv(env({ OAUTH_HUBSPOT_CLIENT_SECRET: 's3cr3t' }))).toThrow(/falta el ID/);
  });
});

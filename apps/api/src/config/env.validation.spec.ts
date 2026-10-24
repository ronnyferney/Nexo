import { Logger } from '@nestjs/common';
import { secretWeaknesses, validateEnv } from './env.validation';

const STRONG_JWT = 'f3a9c1d27be84f6a90c5e1b2d7a4c8e9b1f0a3d5c7e9f2b4a6c8d0e1f3a5b7c9';
const STRONG_KEY = '6b1f9e2c4a7d3e8f0c5b9a1d2e4f6a8c7b3d5e9f1a2c4e6b8d0f3a5c7e9b1d2f';

const env = (over: Record<string, unknown> = {}) => ({
  DATABASE_URL: 'postgresql://nexo:nexo@localhost:5432/nexo',
  JWT_SECRET: STRONG_JWT,
  ENCRYPTION_KEY: STRONG_KEY,
  ...over,
});

describe('validateEnv · secretos débiles (M9)', () => {
  let warn: jest.SpyInstance;
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

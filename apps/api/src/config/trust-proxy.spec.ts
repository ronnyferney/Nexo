import { registrationModeFrom, sessionCookieSecureFrom, swaggerEnabledFrom } from './configuration';
import { maskEmail } from '../infrastructure/mail/mail.service';
import { parseTrustProxy, trustProxyError } from './trust-proxy';

describe('TRUST_PROXY (A5)', () => {
  it('por defecto confía en saltos privados en producción y solo en loopback fuera de ella', () => {
    expect(parseTrustProxy(undefined, 'production')).toEqual(['loopback', 'uniquelocal']);
    expect(parseTrustProxy('', 'production')).toEqual(['loopback', 'uniquelocal']);
    expect(parseTrustProxy(undefined, 'development')).toEqual(['loopback']);
    expect(parseTrustProxy(undefined, undefined)).toEqual(['loopback']);
  });

  it('acepta booleanos, número de saltos y listas', () => {
    expect(parseTrustProxy('false', 'production')).toBe(false);
    expect(parseTrustProxy('TRUE', 'production')).toBe(true);
    expect(parseTrustProxy('2', 'production')).toBe(2);
    expect(parseTrustProxy(' loopback , 10.0.0.0/16 ', 'production')).toEqual(['loopback', '10.0.0.0/16']);
  });

  it('rechaza valores que Express no entiende', () => {
    expect(trustProxyError('loopback,10.0.0.0/8,::1,fd00::/8,linklocal')).toBeNull();
    expect(trustProxyError('nginx')).toMatch(/"nginx"/);
  });
});

describe('SWAGGER_ENABLED (B10)', () => {
  it('se publica fuera de producción y en producción solo con SWAGGER_ENABLED=true', () => {
    expect(swaggerEnabledFrom({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabledFrom({})).toBe(true);
    expect(swaggerEnabledFrom({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabledFrom({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
    expect(swaggerEnabledFrom({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(false);
  });
});

describe('SESSION_COOKIE_SECURE (M6)', () => {
  it('Secure por defecto solo en producción; el valor explícito manda', () => {
    expect(sessionCookieSecureFrom({ NODE_ENV: 'production' })).toBe(true);
    expect(sessionCookieSecureFrom({})).toBe(false);
    expect(sessionCookieSecureFrom({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'TRUE' })).toBe(true);
    expect(sessionCookieSecureFrom({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toBe(false);
  });
});

describe('REGISTRATION_MODE (C1)', () => {
  it('por defecto cerrado en producción y abierto fuera; el valor explícito manda', () => {
    expect(registrationModeFrom({ NODE_ENV: 'production' })).toBe('invite_only');
    expect(registrationModeFrom({ NODE_ENV: 'development' })).toBe('open');
    expect(registrationModeFrom({ NODE_ENV: 'production', REGISTRATION_MODE: 'OPEN' })).toBe('open');
    expect(registrationModeFrom({ REGISTRATION_MODE: 'invite_only' })).toBe('invite_only');
  });

  it('enmascara correos para registros y la página pública de invitación', () => {
    expect(maskEmail('maria.gomez@cliente.com')).toBe('m***@cliente.com');
    expect(maskEmail('sin-arroba')).toBe('***');
  });
});

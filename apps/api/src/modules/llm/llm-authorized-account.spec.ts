import { accountFromIdToken, accountFromUserinfo, ACCOUNT_UNAVAILABLE } from './llm-authorized-account';

const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.firma`;

describe('Cuenta autorizada del código de dispositivo (M1b)', () => {
  const now = Date.UTC(2026, 9, 24);
  const exp = now / 1000 + 3600;

  it('lee la identidad del id_token cuando la audiencia es la app de Nexo', () => {
    const token = jwt({
      sub: '42',
      aud: 'nexo-hf-app',
      exp,
      email: 'ana@acme.test',
      name: 'Ana',
      preferred_username: 'ana',
    });
    expect(accountFromIdToken(token, 'nexo-hf-app', now)).toEqual({
      available: true,
      source: 'id_token',
      subject: '42',
      email: 'ana@acme.test',
      name: 'Ana',
      username: 'ana',
    });
    expect(accountFromIdToken(jwt({ sub: 's', aud: ['otra', 'nexo-hf-app'], exp }), 'nexo-hf-app', now)).toMatchObject({
      available: true,
      subject: 's',
    });
  });

  it('ignora id_token de otra audiencia, vencidos, mal formados o sin identidad', () => {
    expect(accountFromIdToken(jwt({ sub: '1', aud: 'otra-app', exp }), 'nexo', now)).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromIdToken(jwt({ sub: '1', aud: 'nexo', exp: now / 1000 - 3600 }), 'nexo', now)).toBe(
      ACCOUNT_UNAVAILABLE,
    );
    expect(accountFromIdToken('no-es-un-jwt', 'nexo', now)).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromIdToken('a.%%%.c', 'nexo', now)).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromIdToken(jwt({ aud: 'nexo', exp }), 'nexo', now)).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromIdToken(undefined, 'nexo', now)).toBe(ACCOUNT_UNAVAILABLE);
  });

  it('lee respuestas de usuario estilo OIDC y GitHub, y limpia caracteres de control y longitud', () => {
    expect(accountFromUserinfo({ sub: 'u-1', email: 'dev@nexo.local' })).toEqual({
      available: true,
      source: 'userinfo',
      subject: 'u-1',
      email: 'dev@nexo.local',
    });
    expect(accountFromUserinfo({ id: 99, login: 'octocat', name: 'The Octocat' })).toEqual({
      available: true,
      source: 'userinfo',
      subject: '99',
      username: 'octocat',
      name: 'The Octocat',
    });
    const long = accountFromUserinfo({ name: `Ana\u0007\u001b[31m${'x'.repeat(500)}` });
    expect([...long.name!].some((c) => c.charCodeAt(0) < 0x20)).toBe(false);
    expect(long.name!.length).toBe(200);
    expect(accountFromUserinfo(null)).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromUserinfo(['x'])).toBe(ACCOUNT_UNAVAILABLE);
    expect(accountFromUserinfo({ email: 5 })).toBe(ACCOUNT_UNAVAILABLE);
  });
});

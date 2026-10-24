import { REDACTED, redactUrl } from './redact-url';

describe('redactUrl (B1)', () => {
  it('oculta el token de los webhooks y conserva la query no sensible', () => {
    expect(redactUrl('/api/hooks/wh_9f8e7d6c5b4a?wait=true')).toBe(`/api/hooks/${REDACTED}?wait=true`);
    expect(redactUrl('/api/hooks/wh_secreto')).toBe(`/api/hooks/${REDACTED}`);
  });

  it('oculta code y state de los callbacks OAuth (conectores y proveedores IA)', () => {
    expect(redactUrl('/api/oauth/callback?code=abc123&state=eyJhbGc.x.y')).toBe(
      `/api/oauth/callback?code=${REDACTED}&state=${REDACTED}`,
    );
    expect(redactUrl('/api/llm/oauth/vertex/callback?state=s&code=c&scope=cloud-platform')).toBe(
      `/api/llm/oauth/vertex/callback?state=${REDACTED}&code=${REDACTED}&scope=cloud-platform`,
    );
    expect(redactUrl('/api/x?Access_Token=t&%63ode=c&error=access_denied')).toBe(
      `/api/x?Access_Token=${REDACTED}&%63ode=${REDACTED}&error=access_denied`,
    );
  });

  it('no altera otras rutas ni falla con entradas raras', () => {
    expect(redactUrl('/api/workflows/abc/run')).toBe('/api/workflows/abc/run');
    expect(redactUrl('/api/x?%E0%A4%A=1&flag')).toBe('/api/x?%E0%A4%A=1&flag');
    expect(redactUrl(undefined)).toBe('');
  });
});

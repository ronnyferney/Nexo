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

  it('oculta los tokens de invitación y de verificación de correo (C1)', () => {
    expect(redactUrl('/api/auth/invitations/inv_abc123')).toBe(`/api/auth/invitations/${REDACTED}`);
    expect(redactUrl('/api/auth/invitations/inv_abc123/accept')).toBe(`/api/auth/invitations/${REDACTED}/accept`);
    expect(redactUrl('/api/auth/verify-email/eyJ.x.y')).toBe(`/api/auth/verify-email/${REDACTED}`);
    expect(redactUrl('/api/auth/verify-email/request')).toBe('/api/auth/verify-email/request');
  });

  it('oculta el token de las páginas de recuperación de contraseña, invitación y verificación de la web', () => {
    expect(redactUrl('/restablecer/pwr_abc123')).toBe(`/restablecer/${REDACTED}`);
    expect(redactUrl('/invitacion/inv_abc123')).toBe(`/invitacion/${REDACTED}`);
    expect(redactUrl('/verificar-correo/eyJ.x.y')).toBe(`/verificar-correo/${REDACTED}`);
    // El token de restablecimiento viaja en el cuerpo de la API, no en la ruta.
    expect(redactUrl('/api/auth/password/reset')).toBe('/api/auth/password/reset');
    expect(redactUrl('/api/auth/password/reset?token=pwr_x')).toBe(`/api/auth/password/reset?token=${REDACTED}`);
  });
});

import { bindingMatches, bindingTag, browserBindingCookie, newBrowserBinding } from './browser-binding';

describe('ligadura OAuth al navegador', () => {
  it('la huella del state corresponde solo a su nonce', () => {
    const { nonce, tag } = newBrowserBinding();
    expect(tag).toBe(bindingTag(nonce));
    expect(tag).not.toContain(nonce);
    expect(bindingMatches(tag, nonce)).toBe(true);
    expect(bindingMatches(tag, newBrowserBinding().nonce)).toBe(false);
    expect(bindingMatches(tag, undefined)).toBe(false);
    expect(bindingMatches(undefined, nonce)).toBe(false);
  });

  it('cookie HttpOnly SameSite=Lax con su propio nombre y path', () => {
    const cookie = browserBindingCookie('nexo_x_oauth', '/api/x');
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    cookie.set(res as never, 'abc', true);
    expect(res.cookie).toHaveBeenCalledWith('nexo_x_oauth', 'abc', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/api/x',
      maxAge: 600_000,
    });
    cookie.clear(res as never, false);
    expect(res.clearCookie).toHaveBeenCalledWith('nexo_x_oauth', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/api/x',
    });
  });

  it('lee solo su cookie y rechaza valores con otro formato', () => {
    const cookie = browserBindingCookie('nexo_x_oauth', '/api/x');
    const nonce = newBrowserBinding().nonce;
    expect(cookie.read({ headers: { cookie: `otra=1; nexo_x_oauth=${nonce}` } })).toBe(nonce);
    expect(cookie.read({ headers: { cookie: `nexo_llm_oauth=${nonce}` } })).toBeUndefined();
    expect(cookie.read({ headers: { cookie: 'nexo_x_oauth=<script>' } })).toBeUndefined();
    expect(cookie.read({ headers: {} })).toBeUndefined();
  });
});

import { HttpClient, provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MOCK_PLATFORM_LOCATION_CONFIG } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService, CSRF_COOKIE, CSRF_HEADER } from './auth.service';
import type { Me } from './models';

const ME: Me = {
  id: 'u1',
  email: 'ana@nexo.test',
  name: 'Ana',
  emailVerifiedAt: null,
  activeWorkspaceId: 'w2',
  memberships: [
    { role: 'VIEWER', workspace: { id: 'w1', name: 'Uno', slug: 'uno' } },
    { role: 'ADMIN', workspace: { id: 'w2', name: 'Dos', slug: 'dos' } },
  ],
};

describe('AuthService (sesión en cookie, M6)', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        // El interceptor XSRF de Angular compara el origen de la petición con el de la página.
        { provide: MOCK_PLATFORM_LOCATION_CONFIG, useValue: { startUrl: 'http://localhost/' } },
        provideHttpClient(
          withInterceptors([authInterceptor]),
          withXsrfConfiguration({ cookieName: CSRF_COOKIE, headerName: CSRF_HEADER }),
        ),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  afterEach(() => {
    http.verify();
    document.cookie = `${CSRF_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it('al arrancar borra el JWT heredado de localStorage y toma la sesión de GET /auth/me', async () => {
    localStorage.setItem('nexo.session', JSON.stringify({ accessToken: 'viejo' }));
    const done = auth.init();
    const req = http.expectOne('/api/auth/me');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush(ME);
    await done;
    expect(localStorage.getItem('nexo.session')).toBeNull();
    expect(auth.isAuthenticated()).toBeTrue();
    expect(auth.session()).toEqual({ workspaceId: 'w2', role: 'ADMIN' });
    expect(auth.isAdmin()).toBeTrue();
  });

  it('sin cookie de sesión (401 en /auth/me) arranca sin sesión y sin redirigir', async () => {
    const done = auth.init();
    http.expectOne('/api/auth/me').flush({ message: 'Credenciales requeridas' }, { status: 401, statusText: 'x' });
    await done;
    expect(auth.isAuthenticated()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('login no guarda nada en localStorage: la sesión queda en la cookie y el estado en /auth/me', async () => {
    const done = auth.login('ana@nexo.test', 'clave');
    http.expectOne('/api/auth/login').flush({ accessToken: 'jwt', workspaceId: 'w2', role: 'ADMIN' });
    await Promise.resolve();
    http.expectOne('/api/auth/me').flush(ME);
    await done;
    expect(localStorage.getItem('nexo.session')).toBeNull();
    expect(auth.me()?.email).toBe('ana@nexo.test');
  });

  it('las escrituras llevan X-CSRF-Token con el valor de la cookie nexo_csrf', () => {
    document.cookie = `${CSRF_COOKIE}=valor-csrf; path=/`;
    TestBed.inject(HttpClient).post('/api/agents', {}).subscribe();
    const req = http.expectOne('/api/agents');
    expect(req.request.headers.get(CSRF_HEADER)).toBe('valor-csrf');
    expect(req.request.withCredentials).toBeTrue();
    req.flush({});
    expect(auth.csrfHeaders()).toEqual({ [CSRF_HEADER]: 'valor-csrf' });
  });

  it('logout llama a POST /auth/logout, olvida la sesión y vuelve al login', async () => {
    auth.me.set(ME);
    const done = auth.logout();
    http.expectOne({ method: 'POST', url: '/api/auth/logout' }).flush({ loggedOut: true });
    await done;
    expect(auth.isAuthenticated()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {});
  });

  it('un 401 con sesión activa la da por terminada', () => {
    auth.me.set(ME);
    TestBed.inject(HttpClient).get('/api/agents').subscribe({ error: () => undefined });
    http.expectOne('/api/agents').flush({}, { status: 401, statusText: 'x' });
    expect(auth.isAuthenticated()).toBeFalse();
    expect(router.navigate).toHaveBeenCalled();
  });
});

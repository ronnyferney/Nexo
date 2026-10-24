import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { AuthService, CSRF_COOKIE, CSRF_HEADER } from './core/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    // Sesión en cookie HttpOnly (M6): doble envío CSRF con la cookie `nexo_csrf` en `X-CSRF-Token`.
    provideHttpClient(
      withInterceptors([authInterceptor]),
      withXsrfConfiguration({ cookieName: CSRF_COOKIE, headerName: CSRF_HEADER }),
    ),
    // El estado de la sesión sale de `GET /auth/me` antes de la primera navegación (los guards lo consultan).
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Peticiones a la API con la cookie de sesión (`withCredentials`, M6); el token CSRF lo añade `HttpClient`
 * (`withXsrfConfiguration` en `app.config.ts`). Un 401 con sesión activa la da por terminada.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toApi = req.url.startsWith(`${environment.apiUrl}/`);
  const request = toApi ? req.clone({ withCredentials: true }) : req;
  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && toApi && auth.isAuthenticated() && !req.url.endsWith('/auth/logout')) auth.expire();
      return throwError(() => err);
    }),
  );
};

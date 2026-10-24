import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerException, type ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/** Intentos de inicio de sesión por cuenta (correo normalizado) en la ventana, cualquiera sea la IP de origen. */
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_ACCOUNT_TTL_MS = 15 * 60_000;
export const LOGIN_ACCOUNT_THROTTLER = 'login-account';

/** Correo tal como lo busca `AuthService.login`: sin espacios y en minúsculas. */
export function normalizeLoginEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length ? email : null;
}

/**
 * Límite por cuenta en `POST /auth/login`, adicional al límite por IP del `ThrottlerGuard` global: frena la fuerza
 * bruta distribuida (muchas IP contra un mismo correo). Usa el mismo almacenamiento del limitador (Redis), así que
 * cuenta entre réplicas y las pruebas E2E lo sustituyen junto con el resto. La clave es un hash del correo: el correo
 * no queda en Redis.
 */
@Injectable()
export class LoginAccountThrottlerGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ body?: { email?: unknown } }>();
    const email = normalizeLoginEmail(req.body?.email);
    // Sin correo válido no hay cuenta que proteger: la validación del DTO responde 400.
    if (!email) return true;
    const key = createHash('sha256').update(`login:${email}`).digest('hex');
    const record = await this.storage.increment(
      key,
      LOGIN_ACCOUNT_TTL_MS,
      LOGIN_ACCOUNT_LIMIT,
      LOGIN_ACCOUNT_TTL_MS,
      LOGIN_ACCOUNT_THROTTLER,
    );
    if (record.isBlocked) {
      http.getResponse<{ setHeader(name: string, value: number): void }>().setHeader('Retry-After', record.timeToBlockExpire);
      throw new ThrottlerException('Demasiados intentos de inicio de sesión para esta cuenta; intente más tarde');
    }
    return true;
  }
}

import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';

/** Vida del enlace de recuperación de contraseña. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
/** Enlaces vigentes por cuenta: más solicitudes se ignoran en silencio (evita inundar el buzón de alguien). */
export const PASSWORD_RESET_MAX_ACTIVE = 3;
export const PASSWORD_RESET_PREFIX = 'pwr_';

/**
 * Crea un enlace de recuperación de un solo uso (solo se guarda su SHA-256) y devuelve el token en claro, que solo
 * existe en esta respuesta. Lo usan `AuthService` (enlace por correo) y `auth-reset-link.cli.ts` (operador sin SMTP).
 */
export async function createPasswordResetToken(
  prisma: Pick<PrismaClient, 'passwordResetToken'>,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = `${PASSWORD_RESET_PREFIX}${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: CryptoService.sha256(token), expiresAt },
  });
  return { token, expiresAt };
}

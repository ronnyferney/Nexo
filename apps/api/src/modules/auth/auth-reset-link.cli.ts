import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { createPasswordResetToken, PASSWORD_RESET_TTL_MS } from './password-reset-token';

/**
 * `npm run auth:reset-link -- --email=persona@empresa.com` (en la imagen de producción:
 * `node dist/modules/auth/auth-reset-link.cli.js --email=…`): genera un enlace de recuperación de contraseña de un solo
 * uso (30 minutos) para cuando Nexo no tiene correo saliente (`SMTP_URL`). Solo lo puede ejecutar quien tiene acceso
 * al servidor y a la base de datos; el enlace se entrega a la persona por un canal de confianza. Restablecer con él
 * cierra todas las sesiones de la cuenta, igual que el enlace por correo.
 */
async function main() {
  // Mismas variables que la API (apps/api/.env); las del entorno tienen prioridad.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const email = process.argv
    .slice(2)
    .find((a) => a.startsWith('--email='))
    ?.slice('--email='.length)
    .trim()
    .toLowerCase();
  if (!email) throw new Error('Indique el correo: npm run auth:reset-link -- --email=persona@empresa.com');
  const webUrl = (process.env.WEB_URL ?? 'http://localhost:4200').replace(/\/+$/, '');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error(`No existe ninguna cuenta con el correo ${email} en esta base de datos`);
    const { token } = await createPasswordResetToken(prisma, user.id);
    console.log(
      `Enlace de recuperación para ${email} (un solo uso, vence en ${PASSWORD_RESET_TTL_MS / 60_000} minutos):\n` +
        `${webUrl}/restablecer/${token}\n` +
        'Entréguelo solo a la persona dueña de la cuenta. Al usarlo se cierran todas sus sesiones.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

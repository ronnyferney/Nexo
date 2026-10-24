import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { CryptoService } from './crypto.service';
import { rotateCiphertexts, rotationTargets } from './crypto-rotation';
import { parseKeyring } from './keyring';

/**
 * `npm run crypto:rotate [-- --dry-run] [--batch-size=200] [--workspace=<id>]` (en la imagen de producción:
 * `node dist/common/crypto/crypto-rotate.cli.js`): re-cifra con la clave activa (`ENCRYPTION_ACTIVE_KID`) todos los
 * valores en formato legacy o con otra clave. Idempotente; se puede ejecutar con la API en marcha. Sale con código 1
 * si algún valor no se pudo descifrar (falta su clave o el dato está dañado). Ver `docs/rotacion-de-claves.md`.
 */
async function main() {
  // Mismas variables que la API (apps/api/.env); las del entorno tienen prioridad.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batchArg = args.find((a) => a.startsWith('--batch-size='));
  const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 200;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('--batch-size debe ser un entero positivo');
  const workspaceId = args.find((a) => a.startsWith('--workspace='))?.split('=')[1] || undefined;

  const { keyring, errors } = parseKeyring(process.env);
  if (!keyring) throw new Error(`Configuración de cifrado inválida:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  const crypto = new CryptoService(new ConfigService({ encryption: keyring }));
  const prisma = new PrismaClient();
  try {
    console.log(
      `Rotación de cifrado${dryRun ? ' (simulación, sin escribir)' : ''}: clave activa ${crypto.currentKid}, ` +
        `claves disponibles ${Object.keys(keyring.keys).join(', ')}, lotes de ${batchSize}` +
        (workspaceId ? `, solo el workspace ${workspaceId}` : ''),
    );
    const stats = await rotateCiphertexts(crypto, rotationTargets(prisma, { workspaceId }), {
      batchSize,
      dryRun,
      log: (line) => console.log(`  ${line}`),
    });
    const rotated = stats.reduce((n, s) => n + s.rotated, 0);
    const failed = stats.reduce((n, s) => n + s.failed, 0);
    console.log(`Total: ${rotated} ${dryRun ? 'por rotar' : 'rotados'}, ${failed} sin descifrar.`);
    if (failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(`crypto:rotate falló: ${err.message}`);
  process.exit(1);
});

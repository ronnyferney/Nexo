import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ComplianceSeedService, type ResumenSeedWorkspace } from './compliance-seed.service';

/**
 * `npm run compliance:seed -- --workspace=<id>` (o `--all` para todos los workspaces; en la imagen de producción:
 * `node dist/modules/compliance/compliance-seed.cli.js`): siembra de forma IDEMPOTENTE la configuración inicial de la
 * matriz de cumplimiento aprobada por el patrocinador (doc `matriz-cumplimiento-campos.md` §6-bis · autorización
 * 2026-11-03): transversales CO, cobranza CO, salud CO y retail CO ACTIVAS (modo ASESOR, no bloqueante); transversales
 * EC PREPARADAS pero INACTIVAS (activación productiva condicionada a revisión jurídica).
 *
 * Es OPT-IN (no se ejecuta al arranque). Multi-tenant: `--workspace` solo toca ese workspace; `--all` recorre cada uno
 * por separado. Correrlo varias veces no duplica. No afirma conformidad con ninguna norma ni activa ningún gasto.
 */
async function main() {
  // Mismas variables que la API (apps/api/.env); las del entorno tienen prioridad.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const workspaceId = args.find((a) => a.startsWith('--workspace='))?.split('=')[1] || undefined;

  if (all === Boolean(workspaceId)) {
    throw new Error('Indique exactamente uno: --workspace=<id> o --all');
  }

  const prisma = new PrismaClient();
  const seed = new ComplianceSeedService(prisma as unknown as PrismaService);
  try {
    const resultados: ResumenSeedWorkspace[] = all
      ? await seed.seedTodos()
      : [await seed.seedWorkspace(workspaceId as string)];

    const creadas = resultados.reduce((n, r) => n + r.creadas, 0);
    const actualizadas = resultados.reduce((n, r) => n + r.actualizadas, 0);
    const sinCambios = resultados.reduce((n, r) => n + r.sinCambios, 0);
    console.log(
      `Seed matriz de cumplimiento completado en ${resultados.length} workspace(s): ` +
        `${creadas} creada(s), ${actualizadas} actualizada(s), ${sinCambios} sin cambios.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(`compliance:seed falló: ${err.message}`);
  process.exit(1);
});

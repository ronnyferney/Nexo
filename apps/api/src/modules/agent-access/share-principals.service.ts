import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, SharePrincipal } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Tipos de destinatario de un share de agente (ADR 0007 D2/D6). */
export const SHARE_PRINCIPAL_TYPES = ['USER', 'UNIT', 'GROUP'] as const satisfies readonly SharePrincipal[];
export type SharePrincipalType = (typeof SHARE_PRINCIPAL_TYPES)[number];

export interface PrincipalRef {
  principalType: SharePrincipalType;
  principalId: string;
}

/** Ids de principales que alcanzan a un usuario, por tipo (él mismo, su cadena de unidades y sus grupos). */
export type PrincipalIds = Record<SharePrincipalType, string[]>;

/**
 * Cómo resolver cada tipo de principal dentro de un workspace. Agregar un tipo nuevo = una entrada aquí (y en
 * `PrincipalIds` del sujeto en `AgentAccessService`), sin `if (principalType === ...)` dispersos.
 */
interface PrincipalResolver {
  /** Mensaje (400) cuando algún id no pertenece al workspace. */
  missingMessage: string;
  /** Nombres (id → nombre) de los principales del workspace; los que no aparecen no pertenecen a él. */
  names(prisma: PrismaService, workspaceId: string, ids: string[]): Promise<{ id: string; name: string }[]>;
}

const RESOLVERS: Record<SharePrincipalType, PrincipalResolver> = {
  USER: {
    missingMessage: 'Algún usuario no es miembro del workspace',
    names: async (prisma, workspaceId, ids) =>
      (
        await prisma.membership.findMany({
          where: { workspaceId, userId: { in: ids } },
          select: { user: { select: { id: true, name: true } } },
        })
      ).map((m) => m.user),
  },
  UNIT: {
    missingMessage: 'Alguna unidad no existe en el workspace',
    names: (prisma, workspaceId, ids) =>
      prisma.orgUnit.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, name: true } }),
  },
  GROUP: {
    missingMessage: 'Algún grupo no existe en el workspace',
    names: (prisma, workspaceId, ids) =>
      prisma.userGroup.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, name: true } }),
  },
};

const keyOf = (r: PrincipalRef) => `${r.principalType}:${r.principalId}`;

/** Agrupa ids por tipo de principal (sin duplicados). */
export function idsByType(refs: PrincipalRef[]): PrincipalIds {
  const out: PrincipalIds = { USER: [], UNIT: [], GROUP: [] };
  for (const r of refs) if (!out[r.principalType].includes(r.principalId)) out[r.principalType].push(r.principalId);
  return out;
}

/**
 * Filtro de shares que alcanzan a un sujeto: un `OR` por tipo con ids. Un share a una unidad alcanza a su cadena
 * (los ancestros ya vienen en `UNIT`); un share a un grupo, a todos sus miembros.
 */
export function principalFilter(ids: PrincipalIds): Prisma.AgentShareWhereInput[] {
  return SHARE_PRINCIPAL_TYPES.filter((t) => ids[t].length).map((t) => ({
    principalType: t,
    principalId: { in: ids[t] },
  }));
}

/** Valida y nombra los destinatarios de shares (usuarios, unidades y grupos del workspace). */
@Injectable()
export class SharePrincipalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nombres de los principales (clave `TIPO:id`); los que no pertenecen al workspace no aparecen. */
  async names(workspaceId: string, refs: PrincipalRef[]): Promise<Map<string, string>> {
    const byType = idsByType(refs);
    const out = new Map<string, string>();
    await Promise.all(
      SHARE_PRINCIPAL_TYPES.filter((t) => byType[t].length).map(async (t) => {
        for (const p of await RESOLVERS[t].names(this.prisma, workspaceId, byType[t])) {
          out.set(keyOf({ principalType: t, principalId: p.id }), p.name);
        }
      }),
    );
    return out;
  }

  /** Nombre de un principal ya resuelto con `names` ('' si no pertenece al workspace). */
  nameOf(names: Map<string, string>, ref: PrincipalRef): string {
    return names.get(keyOf(ref)) ?? '';
  }

  /** 400 si algún principal no pertenece al workspace (mensaje según el primer tipo con faltantes). */
  async assertExist(workspaceId: string, refs: PrincipalRef[]): Promise<void> {
    const names = await this.names(workspaceId, refs);
    const missing = SHARE_PRINCIPAL_TYPES.find((t) => refs.some((r) => r.principalType === t && !names.has(keyOf(r))));
    if (missing) throw new BadRequestException(RESOLVERS[missing].missingMessage);
  }
}

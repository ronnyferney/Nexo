import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApiKey, Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import {
  apiKeyExpiresAt,
  DEFAULT_API_KEY_EXPIRATION,
  LEGACY_FULL_SCOPE,
  type ApiKeyExpiration,
  type ApiKeyRole,
  type ApiKeyScope,
} from '../../common/guards/api-key-scopes';
import { API_KEY_PREFIX } from '../../common/guards/auth.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  role?: ApiKeyRole;
  expiration?: ApiKeyExpiration;
}

export type ApiKeyRevokeReason = 'manual' | 'account_takeover';

/** Días antes del vencimiento en que la web avisa que conviene rotar la clave. */
export const API_KEY_EXPIRY_WARNING_DAYS = 14;

/**
 * Revoca las API keys que pudo crear quien controlaba una cuenta sin verificar antes de que su dueño real tomara el
 * control (por invitación o por recuperación de contraseña, C1). Criterio:
 *
 * 1. Todas las claves creadas por esa cuenta, en cualquier workspace.
 * 2. En los workspaces donde la cuenta es OWNER y ningún otro miembro es OWNER ni ADMIN, también las claves sin
 *    creador conocido (anteriores a B3, o cuyo creador se eliminó): crear una clave exige ADMIN, así que allí solo esa
 *    cuenta pudo crearlas.
 *
 * Las claves creadas por otros miembros (con su propia cuenta) se conservan. Debe ejecutarse en la misma transacción
 * que invalida las sesiones de la cuenta.
 */
export async function revokeApiKeysOfTakenOverAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
): Promise<number> {
  const owned = await tx.membership.findMany({ where: { userId, role: 'OWNER' }, select: { workspaceId: true } });
  const soleAdminWorkspaces: string[] = [];
  for (const { workspaceId } of owned) {
    const others = await tx.membership.count({
      where: { workspaceId, userId: { not: userId }, role: { in: ['OWNER', 'ADMIN'] } },
    });
    if (!others) soleAdminWorkspaces.push(workspaceId);
  }
  const { count } = await tx.apiKey.updateMany({
    where: {
      revokedAt: null,
      OR: [
        { createdById: userId },
        ...(soleAdminWorkspaces.length ? [{ createdById: null, workspaceId: { in: soleAdminWorkspaces } }] : []),
      ],
    },
    data: { revokedAt: now, revokedReason: 'account_takeover' satisfies ApiKeyRevokeReason },
  });
  return count;
}

type ApiKeyRow = ApiKey & { createdBy?: { name: string; email: string } | null };

/** API keys del workspace (B3): alcance, rol máximo, expiración y revocación. */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { workspaceId },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.view(r));
  }

  /** La llave completa solo se muestra una vez, al crearla. */
  async create(auth: AuthContext, input: CreateApiKeyInput) {
    if (auth.via !== 'jwt' || !auth.userId) {
      throw new ForbiddenException('Las API keys solo se gestionan con una sesión de usuario');
    }
    const role = input.role ?? 'EDITOR';
    if (ROLE_RANK[role] > ROLE_RANK[auth.role]) {
      throw new ForbiddenException('La API key no puede tener un rol mayor que el suyo');
    }
    const expiration = input.expiration ?? DEFAULT_API_KEY_EXPIRATION;
    if (expiration === 'never' && auth.role !== 'OWNER') {
      throw new ForbiddenException('Solo un OWNER puede crear una API key sin expiración');
    }
    const scopes = [...new Set(input.scopes)];
    if (!scopes.length || (scopes as string[]).includes(LEGACY_FULL_SCOPE)) {
      throw new BadRequestException('Elija al menos un alcance válido para la API key');
    }
    const key = `${API_KEY_PREFIX}${CryptoService.randomToken(32)}`;
    const row = await this.prisma.apiKey.create({
      data: {
        workspaceId: auth.workspaceId,
        name: input.name.trim(),
        prefix: key.slice(0, 12),
        hash: CryptoService.sha256(key),
        scopes,
        role,
        expiresAt: apiKeyExpiresAt(expiration),
        createdById: auth.userId,
      },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    return { ...this.view(row), key };
  }

  async revoke(auth: AuthContext, id: string) {
    if (auth.via !== 'jwt') throw new ForbiddenException('Las API keys solo se gestionan con una sesión de usuario');
    const key = await this.prisma.apiKey.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!key) throw new NotFoundException('API key no encontrada');
    if (!key.revokedAt) {
      await this.prisma.apiKey.updateMany({
        where: { id, workspaceId: auth.workspaceId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'manual' satisfies ApiKeyRevokeReason },
      });
    }
    return { revoked: true as const };
  }

  private view(r: ApiKeyRow, now = new Date()) {
    const legacy = r.scopes.includes(LEGACY_FULL_SCOPE);
    const expired = !!r.expiresAt && r.expiresAt <= now;
    const status = r.revokedAt ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE';
    const expiresSoon =
      status === 'ACTIVE' &&
      !!r.expiresAt &&
      r.expiresAt.getTime() - now.getTime() <= API_KEY_EXPIRY_WARNING_DAYS * 24 * 3600 * 1000;
    return {
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      role: r.role,
      /** Clave anterior a B3: alcance completo y sin expiración; conviene rotarla. */
      legacy,
      expiresAt: r.expiresAt,
      status,
      /** Activa sin expiración o a punto de vencer: la web sugiere rotarla. */
      rotationSuggested: status === 'ACTIVE' && (legacy || !r.expiresAt || expiresSoon),
      revokedAt: r.revokedAt,
      revokedReason: r.revokedReason,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      createdBy: r.createdBy ? { name: r.createdBy.name, email: r.createdBy.email } : null,
    };
  }
}

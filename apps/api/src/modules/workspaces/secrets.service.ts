import { Injectable } from '@nestjs/common';
import { CipherContexts } from '../../common/crypto/cipher-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Bóveda de secretos por workspace. Los valores solo se descifran en tiempo de ejecución. */
@Injectable()
export class SecretsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.secret.findMany({
      where: { workspaceId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async upsert(workspaceId: string, name: string, value: string) {
    const ciphertext = this.crypto.encrypt(value, CipherContexts.secret(workspaceId, name));
    const s = await this.prisma.secret.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name, ciphertext },
      update: { ciphertext },
    });
    return { id: s.id, name: s.name };
  }

  async remove(workspaceId: string, id: string) {
    await this.prisma.secret.deleteMany({ where: { id, workspaceId } });
  }

  /** Valores en claro de los secretos existentes entre `names` (los que no existen no aparecen). */
  async resolveMany(workspaceId: string, names: string[]): Promise<Record<string, string>> {
    if (!names.length) return {};
    const rows = await this.prisma.secret.findMany({ where: { workspaceId, name: { in: names } } });
    return Object.fromEntries(
      rows.map((r) => [r.name, this.crypto.decrypt(r.ciphertext, CipherContexts.secret(workspaceId, r.name))]),
    );
  }

  /** Mapa NOMBRE -> valor en claro, para el contexto `secrets` de las plantillas. */
  async resolveAll(workspaceId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.secret.findMany({ where: { workspaceId } });
    return Object.fromEntries(
      rows.map((r) => [r.name, this.crypto.decrypt(r.ciphertext, CipherContexts.secret(workspaceId, r.name))]),
    );
  }
}

import { Injectable } from '@nestjs/common';
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
    const ciphertext = this.crypto.encrypt(value);
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

  /** Mapa NOMBRE -> valor en claro, para el contexto `secrets` de las plantillas. */
  async resolveAll(workspaceId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.secret.findMany({ where: { workspaceId } });
    return Object.fromEntries(rows.map((r) => [r.name, this.crypto.decrypt(r.ciphertext)]));
  }
}

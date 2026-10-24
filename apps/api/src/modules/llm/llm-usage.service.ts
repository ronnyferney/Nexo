import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LlmGatewayService } from './llm-gateway.service';

/** Agente que usa una conexión: como modelo principal o en su cadena de respaldo (`"<conexión>:<modelo>"`). */
export interface ConnectionUsage {
  agentId: string;
  agentName: string;
  model: string;
  role: 'PRIMARY' | 'FALLBACK';
}

/** Error al guardar un agente que apunta a un proveedor o modelo inexistente en su workspace. */
const unknownRef = (what: string, ref: string) =>
  new BadRequestException(`${what} "${ref}" no existe en los proveedores de IA de este workspace`);

/**
 * Vinculación agente ↔ conexión LLM. Valida al guardar que el modelo principal y los respaldos existan en el catálogo
 * del workspace (multi-tenant: nunca una conexión de otro workspace) y protege el borrado de conexiones y modelos en uso.
 */
@Injectable()
export class LlmUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LlmGatewayService,
  ) {}

  /** Valida `provider`/`model` y los respaldos del agente contra el catálogo (incluye modelos deshabilitados). */
  async assertAgentModels(
    workspaceId: string,
    refs: { provider?: string; model?: string; fallbackModels?: string[] },
  ): Promise<void> {
    const catalog = await this.gateway.catalog(workspaceId, true);
    const has = (providerId: string, model?: string) => {
      const entry = catalog.find((c) => c.id === providerId);
      return !!entry && (model === undefined || entry.models.some((m) => m.id === model));
    };
    if (refs.provider !== undefined && !has(refs.provider)) throw unknownRef('El proveedor', refs.provider);
    if (refs.provider !== undefined && refs.model !== undefined && !has(refs.provider, refs.model)) {
      throw unknownRef('El modelo', `${refs.provider}:${refs.model}`);
    }
    for (const ref of refs.fallbackModels ?? []) {
      const i = ref.indexOf(':');
      if (i <= 0 || !has(ref.slice(0, i), ref.slice(i + 1))) throw unknownRef('El modelo de respaldo', ref);
    }
  }

  /** Agentes del workspace que usan la conexión (o uno de sus modelos, si se indica `modelId`). */
  async usage(workspaceId: string, connectionId: string, modelId?: string): Promise<ConnectionUsage[]> {
    const prefix = `${connectionId}:`;
    const agents = await this.prisma.agent.findMany({
      where: {
        workspaceId,
        OR: [{ provider: connectionId }, { fallbackModels: { isEmpty: false } }],
      },
      select: { id: true, name: true, provider: true, model: true, fallbackModels: true },
      orderBy: { name: 'asc' },
    });
    const out: ConnectionUsage[] = [];
    for (const a of agents) {
      if (a.provider === connectionId && (!modelId || a.model === modelId)) {
        out.push({ agentId: a.id, agentName: a.name, model: a.model, role: 'PRIMARY' });
      }
      for (const ref of a.fallbackModels) {
        if (!ref.startsWith(prefix)) continue;
        const model = ref.slice(prefix.length);
        if (!modelId || model === modelId) out.push({ agentId: a.id, agentName: a.name, model, role: 'FALLBACK' });
      }
    }
    return out;
  }

  /** 409 si algún agente usa la conexión o el modelo: hay que reasignarlos antes de borrar. */
  async assertUnused(workspaceId: string, connectionId: string, modelId?: string): Promise<void> {
    const used = await this.usage(workspaceId, connectionId, modelId);
    if (!used.length) return;
    const names = [...new Set(used.map((u) => u.agentName))];
    const list = names.slice(0, 5).join(', ') + (names.length > 5 ? ` y ${names.length - 5} más` : '');
    const what = modelId ? `El modelo "${modelId}"` : 'La conexión';
    throw new ConflictException(
      `${what} está en uso por ${names.length} agente(s) (${list}), como modelo principal o de respaldo; reasígnelos primero`,
    );
  }
}

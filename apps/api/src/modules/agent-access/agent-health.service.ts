import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AgentHealth } from './agent-access.types';

/** Contrato compartido (ADR 0006 D3) — lo implementa nexo-backend-platform. Reglas deterministas, sin costo de IA. */
@Injectable()
export class AgentHealthService {
  async evaluate(workspaceId: string, agentId: string): Promise<AgentHealth> {
    void workspaceId;
    void agentId;
    throw new NotImplementedException('AgentHealthService.evaluate pendiente (nexo-backend-platform)');
  }
}

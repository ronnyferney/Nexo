import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import type { AgentAccess, AgentNeed, AgentScope } from './agent-access.types';

/**
 * Contrato compartido (ADR 0007) — lo implementa nexo-backend-platform. Firmas estables para que otros módulos
 * (Copilot, entrenamiento, rutinas, flujos, MCP) programen contra ellas en paralelo.
 */
@Injectable()
export class AgentAccessService {
  /** Lanza 404 si el agente no es visible para el usuario y 403 si es visible pero falta el permiso. */
  async assert(auth: AuthContext, agentId: string, need: AgentNeed): Promise<AgentAccess> {
    void auth;
    void agentId;
    void need;
    throw new NotImplementedException('AgentAccessService.assert pendiente (nexo-backend-platform)');
  }

  /** Ids de los agentes que el usuario puede USAR en el ámbito indicado. */
  async visibleAgentIds(auth: AuthContext, scope: AgentScope = 'workspace'): Promise<string[]> {
    void auth;
    void scope;
    throw new NotImplementedException('AgentAccessService.visibleAgentIds pendiente (nexo-backend-platform)');
  }
}

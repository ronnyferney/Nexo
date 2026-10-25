import { conversationOwnerFilter } from '../agents/agents.service';
import { routineBlockReason } from '../routines/routines.service';
import { agentRefs } from '../workflows/workflows.service';

describe('Efectos de la visibilidad y el lanzamiento (ADR 0006 D4 / ADR 0007 D4-D5)', () => {
  it('rutinas: solo agentes LAUNCHED o PRIVATE con dueño', () => {
    expect(routineBlockReason({ visibility: 'WORKSPACE', launchStatus: 'LAUNCHED', ownerId: 'u' })).toBeNull();
    expect(routineBlockReason({ visibility: 'TEAM', launchStatus: 'LAUNCHED', ownerId: 'u' })).toBeNull();
    expect(routineBlockReason({ visibility: 'PRIVATE', launchStatus: 'DRAFT', ownerId: 'u' })).toBeNull();
    expect(routineBlockReason({ visibility: 'TEAM', launchStatus: 'DRAFT', ownerId: 'u' })).toMatch(/no está lanzado/);
    expect(routineBlockReason({ visibility: 'PRIVATE', launchStatus: 'DRAFT', ownerId: null })).toMatch(/lanzado/);
  });

  it('rutinas: En validación sigue las reglas de Borrador; Suspendido/Retirado nunca ejecutan (RF06)', () => {
    // En validación: igual que borrador (solo personal con dueño ejecuta).
    expect(routineBlockReason({ visibility: 'PRIVATE', launchStatus: 'EN_VALIDACION', ownerId: 'u' })).toBeNull();
    expect(routineBlockReason({ visibility: 'TEAM', launchStatus: 'EN_VALIDACION', ownerId: 'u' })).toMatch(
      /no está lanzado/,
    );
    // Suspendido y retirado bloquean SIEMPRE, incluso un agente personal con dueño.
    expect(routineBlockReason({ visibility: 'PRIVATE', launchStatus: 'SUSPENDIDO', ownerId: 'u' })).toMatch(
      /suspendido/,
    );
    expect(routineBlockReason({ visibility: 'WORKSPACE', launchStatus: 'SUSPENDIDO', ownerId: 'u' })).toMatch(
      /suspendido/,
    );
    expect(routineBlockReason({ visibility: 'PRIVATE', launchStatus: 'RETIRADO', ownerId: 'u' })).toMatch(/retirado/);
  });

  it('conversaciones privadas: propias; heredadas solo para ADMIN/OWNER; API keys ninguna', () => {
    expect(conversationOwnerFilter({ userId: 'u', workspaceId: 'w', role: 'EDITOR', via: 'jwt' })).toEqual({
      userId: 'u',
    });
    expect(conversationOwnerFilter({ userId: 'u', workspaceId: 'w', role: 'ADMIN', via: 'jwt' })).toEqual({
      OR: [{ userId: 'u' }, { userId: null }],
    });
    expect(conversationOwnerFilter({ workspaceId: 'w', role: 'EDITOR', via: 'apiKey' })).toEqual({ id: { in: [] } });
  });

  it('flujos: extrae las referencias literales de nodos agente', () => {
    const def = {
      nodes: [
        { id: 'trigger', type: 'trigger' as const, name: 'Inicio', config: {} },
        { id: 'a1', type: 'agent' as const, name: 'A', config: { agentId: ' ag-1 ' } },
        { id: 'a2', type: 'agent' as const, name: 'B', config: { agentId: '{{ input.agente }}' } },
        { id: 'a3', type: 'agent' as const, name: 'C', config: {} },
        { id: 'c', type: 'connector' as const, name: 'D', config: { agentId: 'no-cuenta' } },
      ],
      edges: [],
    };
    expect(agentRefs(def)).toEqual([{ nodeId: 'a1', agentId: 'ag-1' }]);
    expect(agentRefs(undefined)).toEqual([]);
  });
});

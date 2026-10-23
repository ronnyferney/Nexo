import { mockCopilotDraft } from '../llm/drivers/mock.driver';
import {
  AGENT_DRAFT_SCHEMA,
  CHANGE_PROPOSAL_SCHEMA,
  referenceErrors,
  validateAgentDraft,
  validateChangeProposal,
  type AgentDraft,
  type WorkspaceRefs,
} from './proposal.schema';

const draft = () => mockCopilotDraft('Crea un agente de soporte para envíos') as unknown as AgentDraft;
const refs = (over: Partial<WorkspaceRefs> = {}): WorkspaceRefs => ({
  models: new Set(['mock:mock-echo', 'anthropic:claude-opus-5-5']),
  operationIds: new Set(['op1', 'op2']),
  skillIds: new Set(['sk1']),
  knowledgeBaseIds: new Set(['kb1']),
  catalogIds: new Set(['hubspot']),
  ...over,
});

describe('validateAgentDraft', () => {
  it('acepta el borrador del MockDriver (contrato compartido con las pruebas)', () => {
    const r = validateAgentDraft(draft());
    expect(r.ok).toBe(true);
  });

  it('exige al menos 5 casos de evaluación', () => {
    const d = draft();
    d.evalCases = d.evalCases.slice(0, 4);
    const r = validateAgentDraft(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('/evalCases');
  });

  it('rechaza propiedades no declaradas (esquema estricto)', () => {
    const r = validateAgentDraft({ ...draft(), visibility: 'WORKSPACE' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('visibility');
  });

  it('exige límites y objetivos en el perfil y un esfuerzo válido', () => {
    const d = draft();
    d.profile = { ...d.profile, boundaries: [] };
    expect(validateAgentDraft(d).ok).toBe(false);
    expect(validateAgentDraft({ ...draft(), effort: 'turbo' }).ok).toBe(false);
  });

  it('cada caso necesita respuesta esperada o criterios', () => {
    const d = draft();
    d.evalCases[0] = { input: 'Solo entrada' };
    expect(validateAgentDraft(d).ok).toBe(false);
  });

  it('distingue skills existentes de nuevas y no admite mezclas', () => {
    expect(validateAgentDraft({ ...draft(), skills: [{ skillId: 'sk1' }] }).ok).toBe(true);
    expect(validateAgentDraft({ ...draft(), skills: [{ skillId: 'sk1', name: 'x' }] }).ok).toBe(false);
    expect(validateAgentDraft({ ...draft(), skills: [{ name: 'Nueva', description: 'd' }] }).ok).toBe(false);
  });

  it('valida cron y zona horaria de las rutinas', () => {
    const bad = validateAgentDraft({ ...draft(), routines: [{ name: 'r', prompt: 'p', schedule: 'cada lunes' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('cron');
    const tz = validateAgentDraft({
      ...draft(),
      routines: [{ name: 'r', prompt: 'p', schedule: '0 8 * * 1', timezone: 'Marte/Olympus' }],
    });
    expect(tz.ok).toBe(false);
  });

  it('el esquema es el inputSchema de la herramienta (objeto en la raíz)', () => {
    expect(AGENT_DRAFT_SCHEMA.type).toBe('object');
    expect(CHANGE_PROPOSAL_SCHEMA.type).toBe('object');
  });
});

describe('validateChangeProposal', () => {
  it('exige al menos un cambio', () => {
    expect(validateChangeProposal({ agentId: 'a1', summary: 's', changes: {} }).ok).toBe(false);
  });

  it('proveedor y modelo van juntos', () => {
    expect(validateChangeProposal({ agentId: 'a1', summary: 's', changes: { provider: 'mock' } }).ok).toBe(false);
    expect(
      validateChangeProposal({ agentId: 'a1', summary: 's', changes: { provider: 'mock', model: 'mock-echo' } }).ok,
    ).toBe(true);
  });

  it('acepta casos de evaluación nuevos', () => {
    const r = validateChangeProposal({
      agentId: 'a1',
      summary: 'Agregar caso',
      changes: { evalCases: [{ input: 'hola', expected: 'saludo' }] },
    });
    expect(r.ok).toBe(true);
  });
});

describe('referenceErrors', () => {
  it('no reporta nada si todas las referencias existen', () => {
    const d: AgentDraft = {
      ...draft(),
      operations: [{ operationId: 'op1', requiresApproval: true }],
      skills: [{ skillId: 'sk1' }, { name: 'Nueva', description: 'd', instructions: 'i', operationIds: ['op2'] }],
      knowledgeBaseIds: ['kb1'],
      integrations: [{ catalogId: 'hubspot' }],
    };
    expect(referenceErrors(d, refs())).toEqual([]);
  });

  it('detecta ids inventados y modelos fuera del catálogo', () => {
    const d: AgentDraft = {
      ...draft(),
      provider: 'openai',
      model: 'gpt-x',
      operations: [{ operationId: 'nope', requiresApproval: false }],
      skills: [{ skillId: 'sk9' }, { name: 'Nueva', description: 'd', instructions: 'i', operationIds: ['zz'] }],
      knowledgeBaseIds: ['kb9'],
      integrations: [{ catalogId: 'erp-inventado' }],
    };
    const errors = referenceErrors(d, refs());
    expect(errors).toHaveLength(6);
    expect(errors[0]).toContain('openai:gpt-x');
  });
});

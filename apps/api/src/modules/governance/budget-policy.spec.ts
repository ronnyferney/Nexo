import {
  blockingUnit,
  degradacionHabilitada,
  modelAllowed,
  overrideVigente,
  periodKey,
  pilotoPermiteProveedor,
  preflight,
  reachedThresholds,
  type UnitBudgetState,
} from './budget-policy';
import { costUsd } from '../llm/pricing';

const unit = (
  name: string,
  budget?: Partial<NonNullable<UnitBudgetState['budget']>>,
  spentUsd = 0,
  allowedModels: string[] = [],
): UnitBudgetState => ({
  orgUnitId: name,
  name,
  allowedModels,
  spentUsd,
  budget: budget
    ? {
        policy: 'BLOCK',
        limitUsd: 100,
        periodKey: '2026-10',
        downgradeProviderId: null,
        downgradeModel: null,
        // Por defecto no crítico y con impacto validado: así una bolsa DOWNGRADE puede degradar (P1.1c). Los casos de
        // criticidad y validación de impacto fijan explícitamente estos campos.
        critico: false,
        impactoValidado: true,
        overrideActive: false,
        ...budget,
      }
    : null,
});

describe('periodKey', () => {
  const d = new Date(Date.UTC(2026, 9, 22));
  it('genera claves por periodo en UTC', () => {
    expect(periodKey('MONTHLY', d)).toBe('2026-10');
    expect(periodKey('QUARTERLY', d)).toBe('2026-Q4');
    expect(periodKey('YEARLY', d)).toBe('2026');
  });
});

describe('preflight', () => {
  it('permite cuando hay saldo en toda la cadena', () => {
    const chain = [unit('Ventas', { limitUsd: 50 }, 10), unit('Empresa', { limitUsd: 1000 }, 500)];
    expect(preflight(chain, 'anthropic', 'claude-opus-5-5')).toEqual({
      action: 'allow',
      providerId: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('bloquea si un ancestro con política BLOCK está agotado', () => {
    const chain = [unit('Ventas', { limitUsd: 50 }, 10), unit('Empresa', { limitUsd: 1000 }, 1000)];
    expect(preflight(chain, 'anthropic', 'm')).toMatchObject({ action: 'block', unitName: 'Empresa' });
  });

  it('degrada al modelo económico cuando la política es DOWNGRADE', () => {
    const chain = [
      unit('Soporte', { policy: 'DOWNGRADE', limitUsd: 20, downgradeModel: 'claude-haiku-5-5' }, 25),
      unit('Empresa'),
    ];
    expect(preflight(chain, 'anthropic', 'claude-opus-5-5')).toEqual({
      action: 'downgrade',
      providerId: 'anthropic',
      model: 'claude-haiku-5-5',
      unitName: 'Soporte',
    });
  });

  it('DOWNGRADE sin modelo configurado bloquea', () => {
    const chain = [unit('Soporte', { policy: 'DOWNGRADE', limitUsd: 20 }, 25)];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('block');
  });

  it('ALERT_ONLY nunca bloquea', () => {
    const chain = [unit('I+D', { policy: 'ALERT_ONLY', limitUsd: 1 }, 999)];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('allow');
  });

  it('respeta la restricción de modelos de la unidad más cercana', () => {
    const chain = [unit('Ventas'), unit('Empresa', undefined, 0, ['anthropic:claude-haiku-5-5'])];
    expect(preflight(chain, 'anthropic', 'claude-opus-5-5')).toMatchObject({
      action: 'forbidden-model',
      unitName: 'Empresa',
    });
    expect(modelAllowed(chain, 'anthropic:claude-haiku-5-5').ok).toBe(true);
  });

  it('la restricción de una unidad superior aplica aunque la subunidad permita el modelo', () => {
    const chain = [
      unit('Ventas', undefined, 0, ['anthropic:opus']),
      unit('Empresa', undefined, 0, ['anthropic:haiku']),
    ];
    expect(modelAllowed(chain, 'anthropic:opus')).toEqual({ ok: false, unitName: 'Empresa' });
  });

  it('bloquea si el modelo de degradación no está permitido', () => {
    const chain = [
      unit('Soporte', { policy: 'DOWNGRADE', limitUsd: 1, downgradeProviderId: 'ollama', downgradeModel: 'llama' }, 2, [
        'anthropic:m',
      ]),
    ];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('block');
  });

  // --- P1.1c: degradación solo en procesos no críticos y con validación de impacto ---
  it('un proceso CRÍTICO con DOWNGRADE agotado BLOQUEA (no degrada)', () => {
    const chain = [
      unit('Cobranza', { policy: 'DOWNGRADE', limitUsd: 1, downgradeModel: 'eco', critico: true }, 5),
      unit('Empresa'),
    ];
    expect(preflight(chain, 'anthropic', 'm')).toMatchObject({ action: 'block', unitName: 'Cobranza' });
  });

  it('un proceso no crítico SIN validación de impacto BLOQUEA (no degrada)', () => {
    const chain = [
      unit(
        'Soporte',
        { policy: 'DOWNGRADE', limitUsd: 1, downgradeModel: 'eco', critico: false, impactoValidado: false },
        5,
      ),
    ];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('block');
  });

  it('un proceso no crítico CON validación de impacto SÍ degrada', () => {
    const chain = [
      unit(
        'Soporte',
        { policy: 'DOWNGRADE', limitUsd: 1, downgradeModel: 'eco', critico: false, impactoValidado: true },
        5,
      ),
    ];
    expect(preflight(chain, 'anthropic', 'm')).toMatchObject({ action: 'downgrade', model: 'eco' });
  });

  // --- P0.1: override gobernado del bloqueo al 100 % ---
  it('un override vigente deja pasar un BLOCK agotado', () => {
    const chain = [unit('Ventas', { limitUsd: 1, overrideActive: true }, 5), unit('Empresa')];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('allow');
    expect(blockingUnit(chain)).toBeUndefined();
  });

  it('sin override, el BLOCK agotado bloquea', () => {
    const chain = [unit('Ventas', { limitUsd: 1, overrideActive: false }, 5)];
    expect(preflight(chain, 'anthropic', 'm').action).toBe('block');
  });

  // --- P0.1: bolsa por agente como nodo más cercano de la cadena ---
  it('la bolsa del agente (nodo más cercano) bloquea aunque la unidad tenga saldo', () => {
    const agente: UnitBudgetState = { ...unit('Agente Cobrador', { limitUsd: 1 }, 5), orgUnitId: 'agent:a1' };
    const chain = [agente, unit('Ventas', { limitUsd: 100 }, 1), unit('Empresa')];
    expect(preflight(chain, 'anthropic', 'm')).toMatchObject({ action: 'block', unitName: 'Agente Cobrador' });
  });
});

describe('helpers puros de gobierno (P0.1/P1.1c)', () => {
  it('degradacionHabilitada: solo no crítico + impacto validado', () => {
    expect(degradacionHabilitada({ critico: false, impactoValidado: true })).toBe(true);
    expect(degradacionHabilitada({ critico: true, impactoValidado: true })).toBe(false);
    expect(degradacionHabilitada({ critico: false, impactoValidado: false })).toBe(false);
  });

  it('pilotoPermiteProveedor: solo el simulador mock', () => {
    expect(pilotoPermiteProveedor('mock')).toBe(true);
    expect(pilotoPermiteProveedor('anthropic')).toBe(false);
    expect(pilotoPermiteProveedor('openai')).toBe(false);
  });

  it('overrideVigente: no revocado y sin expirar', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    const future = new Date('2026-11-10T00:00:00Z');
    const past = new Date('2026-11-01T00:00:00Z');
    expect(overrideVigente({ expiresAt: future, revokedAt: null }, now)).toBe(true);
    expect(overrideVigente({ expiresAt: past, revokedAt: null }, now)).toBe(false);
    expect(overrideVigente({ expiresAt: future, revokedAt: now }, now)).toBe(false);
  });
});

describe('control en ejecución y alertas', () => {
  it('solo corta por presupuestos BLOCK agotados', () => {
    expect(blockingUnit([unit('A', { policy: 'DOWNGRADE', limitUsd: 1, downgradeModel: 'x' }, 5)])).toBeUndefined();
    expect(blockingUnit([unit('A'), unit('B', { limitUsd: 1 }, 1)])?.name).toBe('B');
  });

  it('calcula umbrales alcanzados', () => {
    expect(reachedThresholds(85, 100, [50, 80, 100])).toEqual([50, 80]);
    expect(reachedThresholds(0, 0, [50])).toEqual([50]);
  });
});

describe('costUsd', () => {
  it('suma entrada, salida, lectura y escritura de caché', () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      { inputUsdPerMTok: 4, outputUsdPerMTok: 20, cacheReadUsdPerMTok: 0.2 },
    );
    expect(cost).toBeCloseTo(4 + 2 + 0.2 + 5, 6);
  });
});

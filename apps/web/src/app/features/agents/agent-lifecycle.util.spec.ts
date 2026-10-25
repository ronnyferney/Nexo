import type { LaunchStatus } from '../../core/access.models';
import {
  canTransition,
  LAUNCH_STATUS_FILTER_OPTIONS,
  LAUNCH_STATUS_META,
  LIFECYCLE_TRANSITIONS,
  launchStatusLabel,
  lifecycleActions,
  type LifecycleActionId,
} from './agent-lifecycle.util';

const ALL: LaunchStatus[] = ['DRAFT', 'EN_VALIDACION', 'LAUNCHED', 'SUSPENDIDO', 'RETIRADO'];

describe('launchStatusLabel', () => {
  it('traduce cada estado al español', () => {
    expect(launchStatusLabel('DRAFT')).toBe('Borrador');
    expect(launchStatusLabel('EN_VALIDACION')).toBe('En validación');
    expect(launchStatusLabel('LAUNCHED')).toBe('Publicado');
    expect(launchStatusLabel('SUSPENDIDO')).toBe('Suspendido');
    expect(launchStatusLabel('RETIRADO')).toBe('Retirado');
  });

  it('cae a Borrador cuando el estado es nulo o indefinido', () => {
    expect(launchStatusLabel(null)).toBe('Borrador');
    expect(launchStatusLabel(undefined)).toBe('Borrador');
  });
});

describe('LAUNCH_STATUS_META', () => {
  it('define etiqueta, tono e ícono para los cinco estados', () => {
    for (const s of ALL) {
      const meta = LAUNCH_STATUS_META[s];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(['neutral', 'info', 'success', 'warning', 'danger']).toContain(meta.tone);
    }
  });
});

describe('canTransition', () => {
  it('permite la ruta feliz Borrador→En validación→Publicado', () => {
    expect(canTransition('DRAFT', 'EN_VALIDACION')).toBe(true);
    expect(canTransition('EN_VALIDACION', 'LAUNCHED')).toBe(true);
  });

  it('permite suspender y reactivar un agente publicado', () => {
    expect(canTransition('LAUNCHED', 'SUSPENDIDO')).toBe(true);
    expect(canTransition('SUSPENDIDO', 'LAUNCHED')).toBe(true);
  });

  it('permite retirar desde cualquier estado no terminal', () => {
    for (const s of ALL.filter((x) => x !== 'RETIRADO')) expect(canTransition(s, 'RETIRADO')).toBe(true);
  });

  it('RETIRADO es terminal: no admite salidas', () => {
    expect(LIFECYCLE_TRANSITIONS.RETIRADO).toEqual([]);
    expect(canTransition('RETIRADO', 'LAUNCHED')).toBe(false);
    expect(canTransition('RETIRADO', 'DRAFT')).toBe(false);
  });

  it('rechaza suspender un borrador (debe pasar antes por publicado)', () => {
    expect(canTransition('DRAFT', 'SUSPENDIDO')).toBe(false);
  });

  it('considera idempotente la transición al mismo estado', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(true);
  });
});

describe('lifecycleActions', () => {
  function ids(status: LaunchStatus): LifecycleActionId[] {
    return lifecycleActions(status).map((a) => a.id);
  }

  it('Borrador ofrece enviar a validación, publicar y retirar', () => {
    expect(ids('DRAFT')).toEqual(['submit-validation', 'launch', 'retire']);
  });

  it('En validación ofrece publicar, volver a borrador y retirar', () => {
    expect(ids('EN_VALIDACION')).toEqual(['launch', 'unlaunch', 'retire']);
  });

  it('Publicado ofrece suspender, volver a borrador y retirar', () => {
    expect(ids('LAUNCHED')).toEqual(['suspend', 'unlaunch', 'retire']);
  });

  it('Suspendido ofrece reactivar, volver a borrador y retirar', () => {
    expect(ids('SUSPENDIDO')).toEqual(['reactivate', 'unlaunch', 'retire']);
  });

  it('Retirado es terminal: no ofrece acciones', () => {
    expect(ids('RETIRADO')).toEqual([]);
  });

  it('cae a las acciones de Borrador cuando el estado es nulo', () => {
    expect(ids(null as unknown as LaunchStatus)).toEqual(['submit-validation', 'launch', 'retire']);
  });

  it('cada acción ofrecida corresponde a una transición válida o al diálogo de publicación', () => {
    const toState: Partial<Record<LifecycleActionId, LaunchStatus>> = {
      'submit-validation': 'EN_VALIDACION',
      launch: 'LAUNCHED',
      unlaunch: 'DRAFT',
      suspend: 'SUSPENDIDO',
      reactivate: 'LAUNCHED',
      retire: 'RETIRADO',
    };
    for (const s of ALL) {
      for (const a of lifecycleActions(s)) {
        expect(canTransition(s, toState[a.id]!)).toBe(true);
      }
    }
  });
});

describe('LAUNCH_STATUS_FILTER_OPTIONS', () => {
  it('lista los cinco estados con su etiqueta', () => {
    expect(LAUNCH_STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      'DRAFT',
      'EN_VALIDACION',
      'LAUNCHED',
      'SUSPENDIDO',
      'RETIRADO',
    ]);
    expect(LAUNCH_STATUS_FILTER_OPTIONS.find((o) => o.value === 'EN_VALIDACION')?.label).toBe('En validación');
  });
});

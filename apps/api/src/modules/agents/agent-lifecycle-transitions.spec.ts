import { ConflictException } from '@nestjs/common';
import type { LaunchStatus } from '@prisma/client';
import { assertTransition, LIFECYCLE_LABELS, LIFECYCLE_TRANSITIONS } from './agent-lifecycle.service';

describe('Ciclo de vida del empleado digital (RF05/RF06)', () => {
  const ALL: LaunchStatus[] = ['DRAFT', 'EN_VALIDACION', 'LAUNCHED', 'SUSPENDIDO', 'RETIRADO'];

  it('conserva los estados heredados DRAFT y LAUNCHED y agrega los nuevos', () => {
    expect(Object.keys(LIFECYCLE_LABELS).sort()).toEqual([...ALL].sort());
    expect(LIFECYCLE_LABELS.DRAFT).toBe('Borrador');
    expect(LIFECYCLE_LABELS.LAUNCHED).toBe('Publicado');
  });

  it('permite el flujo Borrador→En validación→Publicado', () => {
    expect(() => assertTransition('DRAFT', 'EN_VALIDACION')).not.toThrow();
    expect(() => assertTransition('EN_VALIDACION', 'LAUNCHED')).not.toThrow();
    // Lanzamiento directo desde borrador (compatibilidad con el flujo actual).
    expect(() => assertTransition('DRAFT', 'LAUNCHED')).not.toThrow();
  });

  it('permite Publicado→Suspendido y Suspendido→Publicado (reactivar)', () => {
    expect(() => assertTransition('LAUNCHED', 'SUSPENDIDO')).not.toThrow();
    expect(() => assertTransition('SUSPENDIDO', 'LAUNCHED')).not.toThrow();
  });

  it('permite retirar desde cualquier estado activo y hace de RETIRADO un estado terminal', () => {
    for (const from of ['DRAFT', 'EN_VALIDACION', 'LAUNCHED', 'SUSPENDIDO'] as LaunchStatus[]) {
      expect(() => assertTransition(from, 'RETIRADO')).not.toThrow();
    }
    expect(LIFECYCLE_TRANSITIONS.RETIRADO).toEqual([]);
    expect(() => assertTransition('RETIRADO', 'LAUNCHED')).toThrow(ConflictException);
    expect(() => assertTransition('RETIRADO', 'DRAFT')).toThrow(ConflictException);
  });

  it('rechaza transiciones inválidas con mensaje en español', () => {
    expect(() => assertTransition('LAUNCHED', 'EN_VALIDACION')).toThrow(/No se puede pasar/);
    expect(() => assertTransition('EN_VALIDACION', 'SUSPENDIDO')).toThrow(ConflictException);
    expect(() => assertTransition('DRAFT', 'SUSPENDIDO')).toThrow(ConflictException);
  });

  it('la transición a sí mismo es idempotente (no lanza)', () => {
    for (const s of ALL) expect(() => assertTransition(s, s)).not.toThrow();
  });
});

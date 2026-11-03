/**
 * Resolución PURA de políticas de retención/privacidad diferenciadas (P0.2 · decisión Jurídica). Sin dependencias de
 * Nest/Prisma: recibe las políticas ya leídas (planas), la retención del workspace y un alcance de consulta, y devuelve
 * la política resuelta de forma determinista.
 *
 * Regla (ADITIVA sobre la retención por workspace): entre las políticas APLICABLES al alcance consultado, gana la MÁS
 * ESPECÍFICA. Una política aplica si su `canal`/`tipoInformacion` es null (comodín) o coincide con el consultado. La
 * especificidad puntúa el canal por encima del tipo para que el desempate sea determinista. Si ninguna política aplica,
 * rige la retención del workspace (180 d por defecto); si el plazo de la política resuelta es null, también hereda del
 * workspace. No declara base legal ni valor probatorio: son controles técnicos.
 */

/** Canal del alcance de una política (coincide con el enum `CanalRetencion` de Prisma). */
export type CanalRetencion = 'CORREO' | 'WHATSAPP' | 'VOZ' | 'CHAT';

/** Tipo de información del alcance (coincide con el enum `TipoInformacion` de Prisma). */
export type TipoInformacion = 'ORDINARIA' | 'EVIDENCIA' | 'SENSIBLE';

/** Política de retención plana (subconjunto relevante de la fila `PoliticaRetencion`). */
export interface PoliticaRetencionPlana {
  canal: CanalRetencion | null;
  tipoInformacion: TipoInformacion | null;
  retencionDias: number | null;
  eliminacionSegura: boolean;
  consentimientoRequerido: boolean;
}

/** Alcance consultado. `canal`/`tipoInformacion` undefined = no se filtra por esa dimensión (solo aplican comodines). */
export interface AlcanceConsulta {
  canal?: CanalRetencion;
  tipoInformacion?: TipoInformacion;
}

/** Origen del que proviene el plazo resuelto. */
export type OrigenRetencion =
  /** Lo fijó una política diferenciada (por canal y/o tipo de información). */
  | 'POLITICA'
  /** No había política aplicable (o su plazo era null): rige la retención del workspace (180 d por defecto). */
  | 'WORKSPACE';

/** Resultado de resolver la retención de un alcance. */
export interface RetencionResuelta {
  /** Plazo de conservación en días; null = sin límite. */
  retencionDias: number | null;
  /** De dónde proviene `retencionDias`. */
  origen: OrigenRetencion;
  /** Eliminación segura al vencer (de la política resuelta; false si no hay política aplicable). */
  eliminacionSegura: boolean;
  /** Si el alcance requiere consentimiento (de la política resuelta; false si no hay política aplicable). */
  consentimientoRequerido: boolean;
  /** Alcance de la política que ganó (null si rige la del workspace). */
  politicaAplicada: { canal: CanalRetencion | null; tipoInformacion: TipoInformacion | null } | null;
}

/** ¿La política aplica al alcance consultado? Un valor null en la política es comodín; undefined en la consulta no filtra. */
function aplica(politica: PoliticaRetencionPlana, alcance: AlcanceConsulta): boolean {
  if (politica.canal !== null && politica.canal !== alcance.canal) return false;
  if (politica.tipoInformacion !== null && politica.tipoInformacion !== alcance.tipoInformacion) return false;
  return true;
}

/** Puntuación de especificidad: el canal pesa más que el tipo para un desempate determinista. */
function especificidad(politica: PoliticaRetencionPlana): number {
  return (politica.canal !== null ? 2 : 0) + (politica.tipoInformacion !== null ? 1 : 0);
}

/**
 * Resuelve la retención de un alcance combinando las políticas diferenciadas con la retención del workspace. La política
 * más específica aplicable gana; si su plazo es null o no hay política aplicable, el plazo lo pone el workspace.
 */
export function resolverRetencion(
  politicas: PoliticaRetencionPlana[],
  workspaceRetencionDias: number | null,
  alcance: AlcanceConsulta,
): RetencionResuelta {
  const aplicables = politicas.filter((p) => aplica(p, alcance)).sort((a, b) => especificidad(b) - especificidad(a));
  const ganadora = aplicables[0];

  if (!ganadora) {
    return {
      retencionDias: workspaceRetencionDias,
      origen: 'WORKSPACE',
      eliminacionSegura: false,
      consentimientoRequerido: false,
      politicaAplicada: null,
    };
  }

  // Plazo propio de la política; si es null, hereda del workspace (aditivo, no rompe lo existente).
  const conPlazoPropio = ganadora.retencionDias !== null;
  return {
    retencionDias: conPlazoPropio ? ganadora.retencionDias : workspaceRetencionDias,
    origen: conPlazoPropio ? 'POLITICA' : 'WORKSPACE',
    eliminacionSegura: ganadora.eliminacionSegura,
    consentimientoRequerido: ganadora.consentimientoRequerido,
    politicaAplicada: { canal: ganadora.canal, tipoInformacion: ganadora.tipoInformacion },
  };
}

import type { TipoAsignacion } from '@prisma/client';

/**
 * Invariantes puras de la estructura empresarial (ADR 0011 D4). Sin dependencias de Nest ni Prisma para poder probarlas
 * de forma aislada. La unicidad de `FUNCIONAL_PRINCIPAL` vigente por sujeto NO se valida aquí: la garantiza el índice
 * parcial único creado por SQL manual en la migración (regla de identidad RF42).
 */

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string };

export interface SujetoAsignacion {
  agentId?: string | null;
  userId?: string | null;
}

export interface DestinoAsignacion {
  orgUnitId?: string | null;
  lineaNegocioId?: string | null;
  sedeId?: string | null;
  proyectoId?: string | null;
}

/** Campo de destino obligatorio según el tipo de asignación. Mapa explícito (sin `if (tipo === ...)` disperso). */
export const CAMPO_DESTINO: Record<TipoAsignacion, keyof DestinoAsignacion> = {
  FUNCIONAL_PRINCIPAL: 'orgUnitId',
  LINEA: 'lineaNegocioId',
  SEDE: 'sedeId',
  PROYECTO: 'proyectoId',
  SERVICIO: 'orgUnitId',
};

/** Un sujeto es exactamente uno: un agente O un miembro (RF42: no se duplica el agente, es una fila de relación). */
export function validarSujeto(sujeto: SujetoAsignacion): ResultadoValidacion {
  const tieneAgente = !!sujeto.agentId;
  const tieneUsuario = !!sujeto.userId;
  if (tieneAgente === tieneUsuario) {
    return { ok: false, mensaje: 'La asignación debe tener exactamente un sujeto: un agente o un miembro, no ambos.' };
  }
  return { ok: true };
}

/** El destino obligatorio según el tipo de asignación debe venir informado. */
export function validarDestino(tipo: TipoAsignacion, destino: DestinoAsignacion): ResultadoValidacion {
  const campo = CAMPO_DESTINO[tipo];
  if (!destino[campo]) {
    return { ok: false, mensaje: `La asignación de tipo ${tipo} requiere el destino "${campo}".` };
  }
  return { ok: true };
}

/** La vigencia es coherente: si hay ambas fechas, `vigenteHasta` no puede ser anterior a `vigenteDesde`. */
export function validarVigencia(vigenteDesde?: Date | null, vigenteHasta?: Date | null): ResultadoValidacion {
  if (vigenteDesde && vigenteHasta && vigenteHasta.getTime() < vigenteDesde.getTime()) {
    return { ok: false, mensaje: 'La fecha de fin de vigencia no puede ser anterior a la de inicio.' };
  }
  return { ok: true };
}

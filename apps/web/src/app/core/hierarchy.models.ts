import type { NivelJerarquico } from './models';

/**
 * Modelos del organigrama / línea de mando de empleados digitales (E3/RF32). Espejan el contrato del backend
 * (`modules/hierarchy/hierarchy.service.ts`): el `nivel` es el nivel efectivo ya resuelto por el servidor.
 */

/** Nodo del organigrama (datos de un agente dentro de la jerarquía). */
export interface NodoOrganigrama {
  id: string;
  nombre: string;
  icono: string | null;
  reportaAAgentId: string | null;
  cargo: { id: string; nombre: string; nivel: NivelJerarquico } | null;
  /** Nivel jerárquico efectivo (resuelto por el backend con la política conservadora). */
  nivel: NivelJerarquico;
  /** Responsable humano del agente, si lo tiene. */
  responsable: { id: string; nombre: string } | null;
}

/** Nodo del árbol: los datos del agente más sus subordinados anidados. Raíces = agentes sin supervisor. */
export type NodoArbol = NodoOrganigrama & { subordinados: NodoArbol[] };

/** Respuesta de `GET /hierarchy/:agentId/cadena-mando`: supervisores del directo hasta la raíz. */
export interface CadenaMando {
  agentId: string;
  cadena: NodoOrganigrama[];
}

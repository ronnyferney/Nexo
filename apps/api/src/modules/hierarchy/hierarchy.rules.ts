import type { NivelJerarquico } from '@prisma/client';

/**
 * Reglas de integridad de la jerarquía / organigrama de empleados digitales (E3/RF32). Funciones PURAS, sin BD ni Nest:
 * la línea de mando se valida con el grafo de aristas (`agentId -> reportaAAgentId`) y el nivel de cada agente, de modo
 * que son probables de forma aislada y sirven como especificación viva.
 *
 * Invariante (ADR 0007): la jerarquía NO concede acceso a datos. Estas funciones solo deciden si la ESTRUCTURA es
 * coherente; el acceso efectivo lo resuelve siempre `AgentAccessService`.
 */

/** Orden de menor a mayor autoridad. El índice es el rango numérico que se compara en la coherencia de nivel. */
export const NIVEL_ORDEN: NivelJerarquico[] = ['EMPLEADO', 'LIDER', 'JEFE', 'DIRECTOR', 'GERENTE', 'SUPEREMPLEADO'];

/**
 * Política conservadora para un agente sin cargo/nivel resoluble: se asume el nivel BASE (`EMPLEADO`, el más bajo del
 * enum y el `@default` de `Cargo.nivel`). Un supervisor sin nivel queda en el escalón más bajo (solo puede supervisar
 * a otros EMPLEADO), por lo que la ausencia de cargo nunca habilita una línea de mando inválida.
 */
export const NIVEL_POR_DEFECTO: NivelJerarquico = 'EMPLEADO';

/** Resuelve el nivel efectivo de un agente aplicando la política conservadora cuando no tiene cargo/nivel. */
export function resolverNivel(nivel: NivelJerarquico | null | undefined): NivelJerarquico {
  return nivel ?? NIVEL_POR_DEFECTO;
}

/** Rango numérico (0 = EMPLEADO … 5 = SUPEREMPLEADO) de un nivel ya resuelto. */
export function rangoNivel(nivel: NivelJerarquico): number {
  return NIVEL_ORDEN.indexOf(nivel);
}

/**
 * Coherencia de nivel (regla 2): el supervisor debe tener un nivel MAYOR O IGUAL que el subordinado (un EMPLEADO no
 * supervisa a un GERENTE). Ambos niveles ya resueltos con `resolverNivel`.
 */
export function nivelSupervisorCoherente(nivelSupervisor: NivelJerarquico, nivelSubordinado: NivelJerarquico): boolean {
  return rangoNivel(nivelSupervisor) >= rangoNivel(nivelSubordinado);
}

/**
 * Detección de ciclos (regla 1): ¿fijar `agentId.reportaA = nuevoSupervisorId` crearía un ciclo? Un agente no puede
 * reportar a sí mismo ni a un descendiente suyo. Se recorre la cadena ascendente del supervisor propuesto; si se
 * alcanza al propio `agentId`, hay ciclo. `padres` mapea cada agente a su supervisor ACTUAL (`reportaAAgentId`).
 */
export function creariaCiclo(
  agentId: string,
  nuevoSupervisorId: string,
  padres: ReadonlyMap<string, string | null>,
): boolean {
  if (nuevoSupervisorId === agentId) return true;
  let actual: string | null | undefined = nuevoSupervisorId;
  const visitados = new Set<string>();
  while (actual) {
    if (actual === agentId) return true;
    if (visitados.has(actual)) break; // Guarda contra datos ya corruptos: no entra en bucle infinito.
    visitados.add(actual);
    actual = padres.get(actual) ?? null;
  }
  return false;
}

/**
 * Cadena de mando ascendente (de un agente hasta la raíz): lista de supervisores desde el directo hasta la raíz, sin
 * incluir al propio agente. Tolerante a datos corruptos (corta ante un ciclo preexistente).
 */
export function cadenaDeMando(agentId: string, padres: ReadonlyMap<string, string | null>): string[] {
  const cadena: string[] = [];
  const visitados = new Set<string>([agentId]);
  let actual = padres.get(agentId) ?? null;
  while (actual) {
    if (visitados.has(actual)) break;
    visitados.add(actual);
    cadena.push(actual);
    actual = padres.get(actual) ?? null;
  }
  return cadena;
}

/** Nodo plano del organigrama para `construirArbol` (datos ya acotados al workspace). */
export interface NodoPlano<T = unknown> {
  id: string;
  reportaAAgentId: string | null;
  datos: T;
}

/** Nodo del árbol: los datos del agente más sus subordinados anidados. */
export type NodoArbol<T = unknown> = T & { subordinados: NodoArbol<T>[] };

/**
 * Construye el organigrama como árbol a partir de la lista plana de agentes del workspace. Raíces = agentes sin
 * supervisor (o cuyo supervisor no está en el conjunto). Ordena hijos y raíces por el comparador dado (por nombre, por
 * defecto estable). Un `reportaAAgentId` que apunte fuera del conjunto se trata como raíz (no se pierde el nodo).
 */
export function construirArbol<T>(
  nodos: NodoPlano<T>[],
  ordenar?: (a: NodoArbol<T>, b: NodoArbol<T>) => number,
): NodoArbol<T>[] {
  const porId = new Map<string, NodoArbol<T>>();
  for (const n of nodos) porId.set(n.id, { ...n.datos, subordinados: [] });
  const raices: NodoArbol<T>[] = [];
  for (const n of nodos) {
    const nodo = porId.get(n.id)!;
    const padre = n.reportaAAgentId ? porId.get(n.reportaAAgentId) : undefined;
    if (padre) padre.subordinados.push(nodo);
    else raices.push(nodo);
  }
  if (ordenar) {
    const ordenarRec = (lista: NodoArbol<T>[]) => {
      lista.sort(ordenar);
      for (const nodo of lista) ordenarRec(nodo.subordinados);
    };
    ordenarRec(raices);
  }
  return raices;
}

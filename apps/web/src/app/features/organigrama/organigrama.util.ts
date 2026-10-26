import { NIVELES_JERARQUICOS } from '../../core/models';
import type { NodoArbol, NodoOrganigrama } from '../../core/hierarchy.models';

/**
 * Lógica pura del organigrama de empleados digitales (E3/RF32), sin Angular ni BD: aplanado para pintar el árbol con
 * sangría, recuento, candidatos válidos a supervisor, visibilidad de acciones por rol y traducción de los motivos de
 * rechazo del backend a un texto accionable. Se prueba de forma aislada (`organigrama.util.spec.ts`).
 */

/** Una fila del árbol aplanado para renderizar con sangría: el nodo, su profundidad y si tiene subordinados. */
export interface FilaOrganigrama {
  nodo: NodoOrganigrama;
  profundidad: number;
  tieneHijos: boolean;
}

/** Cuenta todos los agentes del organigrama (raíces + subordinados en cualquier nivel). */
export function contarAgentes(nodos: readonly NodoArbol[]): number {
  return nodos.reduce((total, n) => total + 1 + contarAgentes(n.subordinados), 0);
}

/** Aplana el árbol a la lista de todos los nodos (sin subordinados anidados), en recorrido en preorden. */
export function aplanarArbol(nodos: readonly NodoArbol[]): NodoOrganigrama[] {
  const salida: NodoOrganigrama[] = [];
  const visitar = (lista: readonly NodoArbol[]) => {
    for (const n of lista) {
      const { subordinados: _omit, ...datos } = n;
      salida.push(datos);
      visitar(n.subordinados);
    }
  };
  visitar(nodos);
  return salida;
}

/**
 * Aplana el árbol en filas visibles para pintar con sangría. Los ids en `colapsados` ocultan a sus subordinados (pero
 * la fila del nodo colapsado sigue visible). Recorrido en preorden: cada hijo justo debajo de su padre.
 */
export function aplanarVisible(nodos: readonly NodoArbol[], colapsados: ReadonlySet<string>): FilaOrganigrama[] {
  const filas: FilaOrganigrama[] = [];
  const visitar = (lista: readonly NodoArbol[], profundidad: number) => {
    for (const n of lista) {
      const { subordinados, ...datos } = n;
      filas.push({ nodo: datos, profundidad, tieneHijos: subordinados.length > 0 });
      if (!colapsados.has(n.id)) visitar(subordinados, profundidad + 1);
    }
  };
  visitar(nodos, 0);
  return filas;
}

/** Ids del nodo `agenteId` y de todo su subárbol (sus descendientes). Vacío si el id no está en el árbol. */
export function idsSubarbol(nodos: readonly NodoArbol[], agenteId: string): string[] {
  const buscar = (lista: readonly NodoArbol[]): NodoArbol | null => {
    for (const n of lista) {
      if (n.id === agenteId) return n;
      const encontrado = buscar(n.subordinados);
      if (encontrado) return encontrado;
    }
    return null;
  };
  const nodo = buscar(nodos);
  if (!nodo) return [];
  const ids: string[] = [];
  const recoger = (n: NodoArbol) => {
    ids.push(n.id);
    for (const hijo of n.subordinados) recoger(hijo);
  };
  recoger(nodo);
  return ids;
}

/**
 * Candidatos válidos a supervisor de `agenteId`: todos los agentes salvo él mismo y sus descendientes (que generarían
 * un ciclo). Ordenados por nivel jerárquico descendente y luego por nombre, para ofrecer primero a los de más autoridad.
 */
export function candidatosSupervisor(nodos: readonly NodoArbol[], agenteId: string): NodoOrganigrama[] {
  const excluidos = new Set(idsSubarbol(nodos, agenteId));
  const rango = new Map(NIVELES_JERARQUICOS.map((n, i) => [n, i]));
  return aplanarArbol(nodos)
    .filter((n) => !excluidos.has(n.id))
    .sort((a, b) => (rango.get(b.nivel) ?? 0) - (rango.get(a.nivel) ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Decide si mostrar la acción de reasignar supervisor: solo con rol de administración (ADMIN/OWNER). */
export function puedeReasignar(isAdmin: boolean): boolean {
  return isAdmin;
}

/**
 * Traduce el motivo de rechazo del backend a un texto accionable para la persona usuaria. Detecta las reglas conocidas
 * (auto-reporte, ciclo, nivel incoherente, supervisor inexistente) por palabras clave; si no reconoce el mensaje, lo
 * devuelve tal cual (el backend ya responde en español).
 */
export function traducirErrorJerarquia(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('sí mismo') || m.includes('si mismo')) {
    return 'Un agente no puede reportar a sí mismo. Elija otro supervisor.';
  }
  if (m.includes('ciclo')) {
    return 'No se puede asignar: ese supervisor depende (directa o indirectamente) de este agente y se formaría un ciclo en la línea de mando.';
  }
  if (m.includes('nivel')) {
    return 'No se puede asignar: el supervisor debe tener un nivel jerárquico mayor o igual que el del agente subordinado.';
  }
  if (m.includes('no existe') || m.includes('no encontrado')) {
    return 'El supervisor indicado ya no existe en este espacio de trabajo. Actualice la página e inténtelo de nuevo.';
  }
  return mensaje;
}

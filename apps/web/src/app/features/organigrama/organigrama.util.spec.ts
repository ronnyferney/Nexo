import type { NivelJerarquico } from '../../core/models';
import type { NodoArbol } from '../../core/hierarchy.models';
import {
  aplanarArbol,
  aplanarVisible,
  candidatosSupervisor,
  contarAgentes,
  idsSubarbol,
  puedeReasignar,
  traducirErrorJerarquia,
} from './organigrama.util';

/** Constructor breve de nodos de árbol para las pruebas. */
function nodo(id: string, nivel: NivelJerarquico, subordinados: NodoArbol[] = []): NodoArbol {
  return {
    id,
    nombre: id,
    icono: null,
    reportaAAgentId: null,
    cargo: { id: `c-${id}`, nombre: nivel, nivel },
    nivel,
    responsable: null,
    subordinados,
  };
}

/**
 *   a (GERENTE)
 *   ├─ b (JEFE)
 *   │  └─ c (EMPLEADO)
 *   └─ d (EMPLEADO)
 *   e (DIRECTOR)  [raíz]
 */
const arbol: NodoArbol[] = [
  nodo('a', 'GERENTE', [nodo('b', 'JEFE', [nodo('c', 'EMPLEADO')]), nodo('d', 'EMPLEADO')]),
  nodo('e', 'DIRECTOR'),
];

describe('organigrama.util', () => {
  describe('contarAgentes', () => {
    it('cuenta raíces y subordinados en cualquier nivel', () => {
      expect(contarAgentes(arbol)).toBe(5);
      expect(contarAgentes([])).toBe(0);
    });
  });

  describe('aplanarArbol', () => {
    it('devuelve todos los nodos en preorden y sin la propiedad subordinados', () => {
      const ids = aplanarArbol(arbol).map((n) => n.id);
      expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(aplanarArbol(arbol).every((n) => !('subordinados' in n))).toBeTrue();
    });
  });

  describe('aplanarVisible', () => {
    it('asigna la profundidad correcta a cada fila', () => {
      const filas = aplanarVisible(arbol, new Set());
      expect(filas.map((f) => [f.nodo.id, f.profundidad])).toEqual([
        ['a', 0],
        ['b', 1],
        ['c', 2],
        ['d', 1],
        ['e', 0],
      ]);
    });

    it('marca qué filas tienen subordinados', () => {
      const filas = aplanarVisible(arbol, new Set());
      const conHijos = filas.filter((f) => f.tieneHijos).map((f) => f.nodo.id);
      expect(conHijos).toEqual(['a', 'b']);
    });

    it('oculta los subordinados de un nodo colapsado pero conserva su fila', () => {
      const ids = aplanarVisible(arbol, new Set(['a'])).map((f) => f.nodo.id);
      expect(ids).toEqual(['a', 'e']);
    });
  });

  describe('idsSubarbol', () => {
    it('incluye al nodo y a todos sus descendientes', () => {
      expect(idsSubarbol(arbol, 'a').sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(idsSubarbol(arbol, 'b').sort()).toEqual(['b', 'c']);
      expect(idsSubarbol(arbol, 'c')).toEqual(['c']);
    });

    it('devuelve vacío si el id no está en el árbol', () => {
      expect(idsSubarbol(arbol, 'zzz')).toEqual([]);
    });
  });

  describe('candidatosSupervisor', () => {
    it('excluye al propio agente y a sus descendientes (evita ciclos)', () => {
      const ids = candidatosSupervisor(arbol, 'a').map((n) => n.id);
      expect(ids).not.toContain('a');
      expect(ids).not.toContain('b');
      expect(ids).not.toContain('c');
      expect(ids).not.toContain('d');
      expect(ids).toEqual(['e']);
    });

    it('ordena por nivel jerárquico descendente y luego por nombre', () => {
      // Para 'c' (EMPLEADO) los candidatos son todos menos él: a(GERENTE), e(DIRECTOR), b(JEFE), d(EMPLEADO).
      const ids = candidatosSupervisor(arbol, 'c').map((n) => n.id);
      expect(ids).toEqual(['a', 'e', 'b', 'd']);
    });
  });

  describe('puedeReasignar', () => {
    it('solo con rol de administración', () => {
      expect(puedeReasignar(true)).toBeTrue();
      expect(puedeReasignar(false)).toBeFalse();
    });
  });

  describe('traducirErrorJerarquia', () => {
    it('traduce el auto-reporte', () => {
      expect(traducirErrorJerarquia('Un agente no puede reportar a sí mismo')).toContain('sí mismo');
    });
    it('traduce el ciclo', () => {
      expect(traducirErrorJerarquia('El supervisor indicado generaría un ciclo en la línea de mando')).toContain(
        'ciclo',
      );
    });
    it('traduce la incoherencia de nivel', () => {
      const out = traducirErrorJerarquia(
        'El nivel jerárquico del supervisor debe ser mayor o igual que el del agente subordinado',
      );
      expect(out).toContain('nivel jerárquico');
    });
    it('traduce el supervisor inexistente', () => {
      expect(traducirErrorJerarquia('El agente supervisor no existe en este workspace')).toContain(
        'ya no existe',
      );
    });
    it('devuelve el mensaje original si no reconoce el motivo', () => {
      expect(traducirErrorJerarquia('Error inesperado del servidor')).toBe('Error inesperado del servidor');
    });
  });
});

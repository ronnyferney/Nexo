import {
  cadenaDeMando,
  construirArbol,
  creariaCiclo,
  nivelSupervisorCoherente,
  rangoNivel,
  resolverNivel,
} from './hierarchy.rules';

/**
 * Especificación de las reglas de integridad de la jerarquía (E3). Pruebas puras, sin BD: ciclos, coherencia de nivel,
 * cadena de mando y construcción del árbol.
 */
describe('Reglas de jerarquía (E3)', () => {
  describe('resolverNivel y coherencia de nivel', () => {
    it('un agente sin cargo/nivel se trata como EMPLEADO (política conservadora)', () => {
      expect(resolverNivel(null)).toBe('EMPLEADO');
      expect(resolverNivel(undefined)).toBe('EMPLEADO');
      expect(resolverNivel('GERENTE')).toBe('GERENTE');
    });

    it('el rango respeta el orden EMPLEADO < LIDER < JEFE < DIRECTOR < GERENTE < SUPEREMPLEADO', () => {
      expect(rangoNivel('EMPLEADO')).toBeLessThan(rangoNivel('LIDER'));
      expect(rangoNivel('DIRECTOR')).toBeLessThan(rangoNivel('GERENTE'));
      expect(rangoNivel('GERENTE')).toBeLessThan(rangoNivel('SUPEREMPLEADO'));
    });

    it('el supervisor debe tener nivel mayor o igual que el subordinado', () => {
      expect(nivelSupervisorCoherente('GERENTE', 'EMPLEADO')).toBe(true);
      expect(nivelSupervisorCoherente('JEFE', 'JEFE')).toBe(true);
      // Un EMPLEADO no puede supervisar a un GERENTE.
      expect(nivelSupervisorCoherente('EMPLEADO', 'GERENTE')).toBe(false);
      expect(nivelSupervisorCoherente('LIDER', 'DIRECTOR')).toBe(false);
    });
  });

  describe('creariaCiclo', () => {
    // Grafo: A raíz; B reporta a A; C reporta a B.
    const padres = new Map<string, string | null>([
      ['A', null],
      ['B', 'A'],
      ['C', 'B'],
    ]);

    it('reportarse a sí mismo es ciclo', () => {
      expect(creariaCiclo('A', 'A', padres)).toBe(true);
    });

    it('reportar a un descendiente es ciclo (A -> C crearía A→C→B→A)', () => {
      expect(creariaCiclo('A', 'C', padres)).toBe(true);
      expect(creariaCiclo('B', 'C', padres)).toBe(true);
    });

    it('reportar a un ancestro o a un no-descendiente es válido', () => {
      expect(creariaCiclo('C', 'A', padres)).toBe(false); // C ya cuelga de A, mover bajo A directo: sin ciclo.
      const conD = new Map(padres).set('D', null);
      expect(creariaCiclo('D', 'A', conD)).toBe(false);
    });

    it('tolera datos ya corruptos sin colgarse (bucle preexistente)', () => {
      const corrupto = new Map<string, string | null>([
        ['X', 'Y'],
        ['Y', 'X'],
      ]);
      expect(creariaCiclo('Z', 'X', corrupto)).toBe(false);
    });
  });

  describe('cadenaDeMando', () => {
    const padres = new Map<string, string | null>([
      ['A', null],
      ['B', 'A'],
      ['C', 'B'],
    ]);

    it('devuelve los supervisores del directo hasta la raíz, sin incluir al agente', () => {
      expect(cadenaDeMando('C', padres)).toEqual(['B', 'A']);
      expect(cadenaDeMando('B', padres)).toEqual(['A']);
      expect(cadenaDeMando('A', padres)).toEqual([]);
    });
  });

  describe('construirArbol', () => {
    it('anida subordinados bajo sus supervisores y deja las raíces arriba', () => {
      const arbol = construirArbol(
        [
          { id: 'A', reportaAAgentId: null, datos: { id: 'A', nombre: 'Ana' } },
          { id: 'B', reportaAAgentId: 'A', datos: { id: 'B', nombre: 'Beto' } },
          { id: 'C', reportaAAgentId: 'A', datos: { id: 'C', nombre: 'Caro' } },
          { id: 'D', reportaAAgentId: 'B', datos: { id: 'D', nombre: 'Dani' } },
        ],
        (x, y) => x.nombre.localeCompare(y.nombre),
      );
      expect(arbol).toHaveLength(1);
      expect(arbol[0].id).toBe('A');
      expect(arbol[0].subordinados.map((n) => n.id)).toEqual(['B', 'C']);
      expect(arbol[0].subordinados[0].subordinados.map((n) => n.id)).toEqual(['D']);
    });

    it('un supervisor fuera del conjunto convierte al nodo en raíz (no se pierde)', () => {
      const arbol = construirArbol([{ id: 'B', reportaAAgentId: 'A', datos: { id: 'B', nombre: 'Beto' } }]);
      expect(arbol.map((n) => n.id)).toEqual(['B']);
    });
  });
});

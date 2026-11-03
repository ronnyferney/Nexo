import {
  destinatarioEnListaBlanca,
  evaluarGuardarrailes,
  leerGuardarrailes,
  tamanoCuerpoBytes,
} from './channel-guardrails';

/**
 * Guardarraíles de la cuenta de canal (ADR 0015 · controles de correo §2/§3). Funciones puras: se prueban aisladas,
 * incluyendo casos de error (destinatario fuera de lista blanca, cuerpo sobredimensionado) y la inercia por defecto.
 */
describe('channel-guardrails', () => {
  describe('leerGuardarrailes', () => {
    it('es inerte sin configuración (config vacío, nulo o indefinido)', () => {
      expect(leerGuardarrailes({})).toEqual({});
      expect(leerGuardarrailes(null)).toEqual({});
      expect(leerGuardarrailes(undefined)).toEqual({});
    });

    it('ignora formas inválidas sin lanzar (lista no-array, elementos no-cadena, tope no positivo)', () => {
      expect(leerGuardarrailes({ destinatariosPermitidos: 'no-es-array' })).toEqual({});
      expect(leerGuardarrailes({ destinatariosPermitidos: [1, '', '  '] })).toEqual({});
      expect(leerGuardarrailes({ maxCuerpoBytes: 0 })).toEqual({});
      expect(leerGuardarrailes({ maxCuerpoBytes: -5 })).toEqual({});
      expect(leerGuardarrailes({ maxCuerpoBytes: 'mil' })).toEqual({});
    });

    it('lee y normaliza lista blanca (recorta espacios) y tope (trunca a entero)', () => {
      expect(
        leerGuardarrailes({
          destinatariosPermitidos: [' *@empresa.test ', 'jefe@empresa.test'],
          maxCuerpoBytes: 1024.9,
        }),
      ).toEqual({ destinatariosPermitidos: ['*@empresa.test', 'jefe@empresa.test'], maxCuerpoBytes: 1024 });
    });
  });

  describe('destinatarioEnListaBlanca', () => {
    it('acepta coincidencia exacta sin distinguir mayúsculas', () => {
      expect(destinatarioEnListaBlanca('Jefe@Empresa.Test', ['jefe@empresa.test'])).toBe(true);
      expect(destinatarioEnListaBlanca('otro@empresa.test', ['jefe@empresa.test'])).toBe(false);
    });

    it('acepta patrón de sufijo `*@dominio`', () => {
      expect(destinatarioEnListaBlanca('ana@empresa.test', ['*@empresa.test'])).toBe(true);
      expect(destinatarioEnListaBlanca('ana@externo.test', ['*@empresa.test'])).toBe(false);
    });
  });

  describe('tamanoCuerpoBytes', () => {
    it('mide bytes UTF-8 (un carácter multibyte cuenta más de 1)', () => {
      expect(tamanoCuerpoBytes('abc')).toBe(3);
      expect(tamanoCuerpoBytes('ñ')).toBe(2);
    });
  });

  describe('evaluarGuardarrailes', () => {
    it('permite cuando no hay guardarraíles (inerte)', () => {
      expect(evaluarGuardarrailes('cualquiera@externo.test', 'hola', {})).toEqual({ ok: true });
    });

    it('bloquea un destinatario fuera de la lista blanca', () => {
      const g = { destinatariosPermitidos: ['*@empresa.test'] };
      expect(evaluarGuardarrailes('interno@empresa.test', 'hola', g)).toEqual({ ok: true });
      expect(evaluarGuardarrailes('externo@otro.test', 'hola', g)).toEqual({
        ok: false,
        motivo: 'DESTINATARIO_FUERA_DE_LISTA_BLANCA',
      });
    });

    it('bloquea un cuerpo que excede el tamaño máximo', () => {
      const g = { maxCuerpoBytes: 4 };
      expect(evaluarGuardarrailes('x@empresa.test', 'abcd', g)).toEqual({ ok: true });
      expect(evaluarGuardarrailes('x@empresa.test', 'abcde', g)).toEqual({
        ok: false,
        motivo: 'CUERPO_EXCEDE_TAMANO_MAXIMO',
      });
    });

    it('la lista blanca se evalúa antes que el tamaño', () => {
      const g = { destinatariosPermitidos: ['*@empresa.test'], maxCuerpoBytes: 1 };
      expect(evaluarGuardarrailes('externo@otro.test', 'cuerpo largo', g)).toEqual({
        ok: false,
        motivo: 'DESTINATARIO_FUERA_DE_LISTA_BLANCA',
      });
    });
  });
});

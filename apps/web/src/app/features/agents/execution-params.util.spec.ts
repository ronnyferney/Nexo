import type { EstacionVirtual } from '../../core/execution-params.models';
import {
  estacionLabel,
  estacionesSeleccionables,
  estadoEstacionBadgeClass,
  estadoEstacionLabel,
  formatParametrosJson,
  parseParametrosJson,
  puedeAdministrarEstaciones,
  puedeEditarParametros,
  salidaInternetResumen,
  validarNombreEstacion,
} from './execution-params.util';

function estacion(partial: Partial<EstacionVirtual> & Pick<EstacionVirtual, 'id' | 'nombre'>): EstacionVirtual {
  return {
    workspaceId: 'ws',
    descripcion: null,
    estado: 'ACTIVA',
    proveedor: null,
    ...partial,
  };
}

describe('execution-params.util', () => {
  describe('estadoEstacionLabel / badge', () => {
    it('traduce los estados conocidos y deja pasar los desconocidos', () => {
      expect(estadoEstacionLabel('ACTIVA')).toBe('Activa');
      expect(estadoEstacionLabel('SUSPENDIDA')).toBe('Suspendida');
      expect(estadoEstacionLabel('RETIRADA')).toBe('Retirada');
      expect(estadoEstacionLabel('OTRO')).toBe('OTRO');
    });
    it('asigna la clase de badge por estado', () => {
      expect(estadoEstacionBadgeClass('ACTIVA')).toBe('success');
      expect(estadoEstacionBadgeClass('SUSPENDIDA')).toBe('warning');
      expect(estadoEstacionBadgeClass('RETIRADA')).toBe('');
    });
  });

  describe('estacionLabel', () => {
    it('añade el proveedor cuando existe', () => {
      expect(estacionLabel({ nombre: 'Robot ventas', proveedor: 'azure' })).toBe('Robot ventas · azure');
      expect(estacionLabel({ nombre: 'Robot ventas', proveedor: null })).toBe('Robot ventas');
    });
  });

  describe('estacionesSeleccionables', () => {
    const activa = estacion({ id: 'a', nombre: 'Beta', estado: 'ACTIVA' });
    const activa2 = estacion({ id: 'b', nombre: 'Alfa', estado: 'ACTIVA' });
    const suspendida = estacion({ id: 's', nombre: 'Sigma', estado: 'SUSPENDIDA' });
    const retirada = estacion({ id: 'r', nombre: 'Omega', estado: 'RETIRADA' });

    it('ofrece solo las activas, ordenadas por nombre', () => {
      const res = estacionesSeleccionables([activa, activa2, suspendida, retirada], null);
      expect(res.map((e) => e.id)).toEqual(['b', 'a']);
    });

    it('incluye la asignada aunque esté suspendida o retirada', () => {
      const res = estacionesSeleccionables([activa, suspendida], 's');
      expect(res.map((e) => e.id).sort()).toEqual(['a', 's']);
    });

    it('no muta la lista original', () => {
      const list = [activa, activa2];
      estacionesSeleccionables(list, null);
      expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    });
  });

  describe('parseParametrosJson', () => {
    it('trata el texto vacío como objeto vacío', () => {
      expect(parseParametrosJson('')).toEqual({ value: {} });
      expect(parseParametrosJson('   ')).toEqual({ value: {} });
    });
    it('acepta un objeto JSON válido', () => {
      expect(parseParametrosJson('{ "horarioOperacion": "L-V 9-18" }')).toEqual({
        value: { horarioOperacion: 'L-V 9-18' },
      });
    });
    it('rechaza JSON malformado', () => {
      expect(parseParametrosJson('{ "a": }').error).toContain('JSON inválido');
    });
    it('rechaza listas y primitivos (debe ser un objeto)', () => {
      expect(parseParametrosJson('[1, 2]').error).toContain('objeto JSON');
      expect(parseParametrosJson('42').error).toContain('objeto JSON');
      expect(parseParametrosJson('"texto"').error).toContain('objeto JSON');
      expect(parseParametrosJson('null').error).toContain('objeto JSON');
    });
  });

  describe('formatParametrosJson', () => {
    it('indenta el objeto y trata null/undefined como objeto vacío', () => {
      expect(formatParametrosJson({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatParametrosJson(null)).toBe('{}');
      expect(formatParametrosJson(undefined)).toBe('{}');
    });
  });

  describe('permisos por rol', () => {
    it('editar parámetros exige EDITOR o superior', () => {
      expect(puedeEditarParametros('OWNER')).toBeTrue();
      expect(puedeEditarParametros('ADMIN')).toBeTrue();
      expect(puedeEditarParametros('EDITOR')).toBeTrue();
      expect(puedeEditarParametros('VIEWER')).toBeFalse();
      expect(puedeEditarParametros(undefined)).toBeFalse();
      expect(puedeEditarParametros(null)).toBeFalse();
    });
    it('administrar estaciones exige ADMIN o superior', () => {
      expect(puedeAdministrarEstaciones('OWNER')).toBeTrue();
      expect(puedeAdministrarEstaciones('ADMIN')).toBeTrue();
      expect(puedeAdministrarEstaciones('EDITOR')).toBeFalse();
      expect(puedeAdministrarEstaciones('VIEWER')).toBeFalse();
    });
  });

  describe('validarNombreEstacion', () => {
    it('acepta nombres de 2 a 120 caracteres', () => {
      expect(validarNombreEstacion('VM')).toBeNull();
      expect(validarNombreEstacion('  Estación válida  ')).toBeNull();
      expect(validarNombreEstacion('x'.repeat(120))).toBeNull();
    });
    it('rechaza nombres demasiado cortos o largos', () => {
      expect(validarNombreEstacion(' a ')).toContain('al menos 2');
      expect(validarNombreEstacion('x'.repeat(121))).toContain('120');
    });
  });

  describe('salidaInternetResumen', () => {
    it('describe el estado del toggle', () => {
      expect(salidaInternetResumen(true)).toContain('control de seguridad');
      expect(salidaInternetResumen(false)).toContain('no puede salir a internet');
    });
  });
});

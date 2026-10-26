import type { ImputacionCosto } from '../../core/imputacion.models';
import {
  barraPorcentaje,
  campoDestino,
  claveFila,
  construirReparto,
  EPSILON_PORCENTAJE,
  filaADestino,
  imputacionesAFilas,
  montoConsolidado,
  nuevaFila,
  periodoActual,
  periodoLabel,
  porcentajeDelTotal,
  repartoCuadra,
  sumaPorcentajes,
  tipoDeImputacion,
  tipoDestinoLabel,
  validarRepartoUI,
  type FilaReparto,
} from './imputacion.util';

const fila = (over: Partial<FilaReparto> = {}): FilaReparto => ({
  tipo: 'linea',
  destinoId: 'l1',
  porcentaje: 100,
  ...over,
});

describe('imputacion.util', () => {
  describe('campoDestino', () => {
    it('mapea cada tipo al campo del contrato', () => {
      expect(campoDestino('linea')).toBe('lineaNegocioId');
      expect(campoDestino('area')).toBe('orgUnitId');
      expect(campoDestino('centro')).toBe('centroCostoId');
    });
  });

  describe('claveFila', () => {
    it('combina tipo y destino, y es vacía sin destino', () => {
      expect(claveFila(fila({ tipo: 'area', destinoId: 'a1' }))).toBe('area:a1');
      expect(claveFila(fila({ destinoId: '' }))).toBe('');
    });
  });

  describe('sumaPorcentajes', () => {
    it('suma tratando los vacíos como cero y redondea a 2 decimales', () => {
      expect(sumaPorcentajes([fila({ porcentaje: 33.33 }), fila({ porcentaje: 33.33 }), fila({ porcentaje: 33.34 })])).toBe(100);
      expect(sumaPorcentajes([fila({ porcentaje: 60 }), fila({ porcentaje: null })])).toBe(60);
      expect(sumaPorcentajes([])).toBe(0);
    });
  });

  describe('repartoCuadra', () => {
    it('acepta 100 exacto y dentro de la tolerancia', () => {
      expect(repartoCuadra([fila({ porcentaje: 100 })])).toBeTrue();
      expect(repartoCuadra([fila({ porcentaje: 100 - EPSILON_PORCENTAJE })])).toBeTrue();
    });
    it('rechaza sumas fuera de tolerancia', () => {
      expect(repartoCuadra([fila({ porcentaje: 99.5 })])).toBeFalse();
      expect(repartoCuadra([fila({ porcentaje: 100.5 })])).toBeFalse();
    });
  });

  describe('validarRepartoUI', () => {
    it('exige al menos una fila', () => {
      const r = validarRepartoUI([]);
      expect(r.ok).toBeFalse();
      expect(r.mensaje).toContain('al menos un destino');
    });

    it('exige un destino elegido en cada fila', () => {
      expect(validarRepartoUI([fila({ destinoId: '' })]).ok).toBeFalse();
    });

    it('exige porcentaje en (0, 100]', () => {
      expect(validarRepartoUI([fila({ porcentaje: null })]).ok).toBeFalse();
      expect(validarRepartoUI([fila({ porcentaje: 0 })]).ok).toBeFalse();
      expect(validarRepartoUI([fila({ porcentaje: 120 })]).ok).toBeFalse();
    });

    it('rechaza destinos repetidos (sin doble conteo)', () => {
      const r = validarRepartoUI([
        fila({ destinoId: 'l1', porcentaje: 50 }),
        fila({ destinoId: 'l1', porcentaje: 50 }),
      ]);
      expect(r.ok).toBeFalse();
      expect(r.mensaje).toContain('dos veces');
    });

    it('permite el mismo id en tipos distintos (claves diferentes)', () => {
      const r = validarRepartoUI([
        fila({ tipo: 'linea', destinoId: 'x', porcentaje: 50 }),
        fila({ tipo: 'area', destinoId: 'x', porcentaje: 50 }),
      ]);
      expect(r.ok).toBeTrue();
    });

    it('exige suma 100 % e informa la suma actual', () => {
      const r = validarRepartoUI([fila({ destinoId: 'l1', porcentaje: 40 }), fila({ destinoId: 'l2', porcentaje: 40 })]);
      expect(r.ok).toBeFalse();
      expect(r.mensaje).toContain('80.00');
    });

    it('acepta un reparto válido que suma 100 %', () => {
      const r = validarRepartoUI([
        fila({ tipo: 'linea', destinoId: 'l1', porcentaje: 70 }),
        fila({ tipo: 'centro', destinoId: 'c1', porcentaje: 30 }),
      ]);
      expect(r).toEqual({ ok: true, mensaje: '' });
    });
  });

  describe('filaADestino / construirReparto', () => {
    it('convierte una fila al destino del contrato', () => {
      expect(filaADestino(fila({ tipo: 'area', destinoId: 'a1', porcentaje: 25 }))).toEqual({
        orgUnitId: 'a1',
        porcentaje: 25,
      });
    });

    it('arma el cuerpo con el periodo recortado y todos los destinos', () => {
      const body = construirReparto('  2026-10 ', [
        fila({ tipo: 'linea', destinoId: 'l1', porcentaje: 60 }),
        fila({ tipo: 'centro', destinoId: 'c1', porcentaje: 40 }),
      ]);
      expect(body.periodoKey).toBe('2026-10');
      expect(body.destinos).toEqual([
        { lineaNegocioId: 'l1', porcentaje: 60 },
        { centroCostoId: 'c1', porcentaje: 40 },
      ]);
    });
  });

  describe('tipoDeImputacion / imputacionesAFilas', () => {
    const imp = (over: Partial<ImputacionCosto>): ImputacionCosto => ({
      id: 'i',
      workspaceId: 'w',
      servicioInternoId: 's',
      periodoKey: '2026-10',
      lineaNegocioId: null,
      orgUnitId: null,
      centroCostoId: null,
      porcentaje: '50',
      createdAt: '',
      ...over,
    });

    it('deduce el tipo según el campo informado', () => {
      expect(tipoDeImputacion(imp({ lineaNegocioId: 'l1' }))).toBe('linea');
      expect(tipoDeImputacion(imp({ orgUnitId: 'a1' }))).toBe('area');
      expect(tipoDeImputacion(imp({ centroCostoId: 'c1' }))).toBe('centro');
    });

    it('mapea el reparto persistido a filas con el porcentaje numérico', () => {
      const filas = imputacionesAFilas([
        imp({ lineaNegocioId: 'l1', porcentaje: '70.00' }),
        imp({ centroCostoId: 'c1', porcentaje: '30.00' }),
      ]);
      expect(filas).toEqual([
        { tipo: 'linea', destinoId: 'l1', porcentaje: 70 },
        { tipo: 'centro', destinoId: 'c1', porcentaje: 30 },
      ]);
    });
  });

  describe('nuevaFila', () => {
    it('crea una fila vacía del tipo pedido', () => {
      expect(nuevaFila()).toEqual({ tipo: 'linea', destinoId: '', porcentaje: null });
      expect(nuevaFila('centro').tipo).toBe('centro');
    });
  });

  describe('periodoActual / periodoLabel', () => {
    it('da la clave mensual YYYY-MM de una fecha', () => {
      expect(periodoActual(new Date(2026, 9, 15))).toBe('2026-10');
      expect(periodoActual(new Date(2026, 0, 1))).toBe('2026-01');
    });
    it('etiqueta claves mensuales en español y deja las no mensuales tal cual', () => {
      expect(periodoLabel('2026-10')).toBe('octubre de 2026');
      expect(periodoLabel('2026-M10')).toBe('2026-M10');
      expect(periodoLabel('2026-13')).toBe('2026-13');
    });
  });

  describe('consolidación: ayudas del gráfico', () => {
    it('montoConsolidado suma medido y estimado', () => {
      expect(montoConsolidado({ costoMedidoUsd: 30, costoEstimadoUsd: 20 })).toBe(50);
    });
    it('barraPorcentaje relativo al máximo', () => {
      expect(barraPorcentaje(50, 200)).toBe(25);
      expect(barraPorcentaje(5, 0)).toBe(0);
    });
    it('porcentajeDelTotal relativo al total', () => {
      expect(porcentajeDelTotal(25, 100)).toBe(25);
      expect(porcentajeDelTotal(1, 0)).toBe(0);
    });
  });

  describe('tipoDestinoLabel', () => {
    it('etiqueta cada tipo en español', () => {
      expect(tipoDestinoLabel('linea')).toBe('Línea de negocio');
      expect(tipoDestinoLabel('area')).toBe('Área');
      expect(tipoDestinoLabel('centro')).toBe('Centro de costo');
    });
  });
});

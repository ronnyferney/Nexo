import {
  formatEntero,
  notaSinConsolidado,
  resumenAuditoria,
  selloIntegridad,
  tieneConsolidado,
} from './consola-gerencial.util';

describe('consola-gerencial.util', () => {
  describe('selloIntegridad', () => {
    it('marca la cadena íntegra en verde (badge success) cuando el flag es true', () => {
      const s = selloIntegridad(true);
      expect(s.integra).toBeTrue();
      expect(s.label).toBe('Cadena íntegra');
      expect(s.badgeClass).toBe('badge success');
      expect(s.icon).toBe('checkCircle');
    });

    it('marca la cadena comprometida en rojo (badge danger) cuando el flag es false', () => {
      const s = selloIntegridad(false);
      expect(s.integra).toBeFalse();
      expect(s.label).toBe('Cadena comprometida');
      expect(s.badgeClass).toBe('badge danger');
      expect(s.icon).toBe('alert');
    });
  });

  describe('tieneConsolidado', () => {
    it('es false cuando el backend no pudo consolidar el alcance (honesto con null)', () => {
      expect(tieneConsolidado({ consolidado: null })).toBeFalse();
    });

    it('es true cuando hay libro consolidado', () => {
      expect(
        tieneConsolidado({
          consolidado: { dimension: 'empresa', totalMedidoUsd: 10, totalEstimadoUsd: 2, grupos: [] },
        }),
      ).toBeTrue();
    });
  });

  describe('notaSinConsolidado', () => {
    it('prioriza la nota del backend', () => {
      expect(notaSinConsolidado({ consolidadoNota: 'Alcance de área: use el costo atribuible.' })).toBe(
        'Alcance de área: use el costo atribuible.',
      );
    });

    it('cae en un texto por defecto cuando no hay nota (nunca una cifra)', () => {
      expect(notaSinConsolidado({ consolidadoNota: null })).toContain('costo atribuible');
      expect(notaSinConsolidado({ consolidadoNota: '   ' })).toContain('costo atribuible');
    });
  });

  describe('formatEntero', () => {
    // El separador de miles depende de los datos ICU del entorno; el contrato es delegar en `Intl` con locale `es`.
    const es = (n: number) => new Intl.NumberFormat('es').format(n);

    it('formatea enteros con el locale español', () => {
      expect(formatEntero(0)).toBe('0');
      expect(formatEntero(1234)).toBe(es(1234));
      expect(formatEntero(1000000)).toBe(es(1000000));
    });
  });

  describe('resumenAuditoria', () => {
    it('combina el sello con los conteos del período', () => {
      expect(resumenAuditoria({ cadenaIntegra: true, hechosEnPeriodo: 12, totalHechos: 3400 })).toBe(
        `Cadena íntegra. 12 hechos en el período de ${formatEntero(3400)} en total.`,
      );
    });

    it('refleja la cadena comprometida', () => {
      expect(resumenAuditoria({ cadenaIntegra: false, hechosEnPeriodo: 0, totalHechos: 0 })).toBe(
        'Cadena comprometida. 0 hechos en el período de 0 en total.',
      );
    });
  });
});

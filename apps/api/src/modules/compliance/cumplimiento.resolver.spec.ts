import { evaluarCumplimiento, resolverReglas, type ReglaCumplimientoPlana } from './cumplimiento.resolver';

/**
 * Especificación del núcleo PURO de la matriz de cumplimiento (P1.3 · ADR 0020). Invariantes: la regla más específica
 * SUMA (unión por campoClave, gana la más específica por campo); los comodines (dimensión null) aplican a todos; la
 * evaluación es ASESORA (devuelve faltantes/invalidos sin lanzar); sin reglas aplicables no exige nada.
 */
describe('matriz de cumplimiento (resolución + evaluación asesora)', () => {
  const base = (p: Partial<ReglaCumplimientoPlana>): ReglaCumplimientoPlana => ({
    jurisdiccion: null,
    sector: null,
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'campo',
    tipoDato: 'TEXTO',
    reglaValidacion: null,
    controlProteccion: null,
    descripcion: null,
    activa: true,
    ...p,
  });

  describe('resolverReglas', () => {
    it('sin reglas: el conjunto resuelto es vacío (no exige nada)', () => {
      expect(resolverReglas([], { sector: 'financiero' })).toEqual([]);
    });

    it('comodín total aplica a cualquier contexto', () => {
      const reglas = [base({ campoClave: 'identificadorFiscal' })];
      const r = resolverReglas(reglas, { sector: 'retail', jurisdiccion: 'EC' });
      expect(r).toHaveLength(1);
      expect(r[0].campoClave).toBe('identificadorFiscal');
    });

    it('la más específica SUMA: campos distintos se acumulan por alcance', () => {
      const reglas = [
        base({ campoClave: 'clasificacionDatos' }), // comodín total
        base({ sector: 'salud', campoClave: 'baseLegalTratamiento' }), // por sector
        base({ sector: 'salud', proceso: 'onboarding', campoClave: 'consentimientoDatosPersonales' }), // sector+proceso
      ];
      const r = resolverReglas(reglas, { sector: 'salud', proceso: 'onboarding' });
      expect(r.map((x) => x.campoClave).sort()).toEqual([
        'baseLegalTratamiento',
        'clasificacionDatos',
        'consentimientoDatosPersonales',
      ]);
    });

    it('mismo campoClave en dos alcances: gana la MÁS específica', () => {
      const reglas = [
        base({ campoClave: 'retencion', tipoDato: 'NUMERO', descripcion: 'general' }),
        base({ sector: 'financiero', campoClave: 'retencion', tipoDato: 'NUMERO', descripcion: 'financiero' }),
      ];
      const r = resolverReglas(reglas, { sector: 'financiero' });
      expect(r).toHaveLength(1);
      expect(r[0].descripcion).toBe('financiero');
      expect(r[0].especificidad).toBeGreaterThan(0);
    });

    it('una regla de otro sector NO aplica; cae a la general aplicable', () => {
      const reglas = [
        base({ sector: 'salud', campoClave: 'consentimientoDatosPersonales' }),
        base({ campoClave: 'clasificacionDatos' }),
      ];
      const r = resolverReglas(reglas, { sector: 'retail' });
      expect(r.map((x) => x.campoClave)).toEqual(['clasificacionDatos']);
    });

    it('una dimensión no provista en el contexto solo admite comodín (null) en esa dimensión', () => {
      const reglas = [base({ sector: 'financiero', campoClave: 'a' }), base({ campoClave: 'b' })];
      const r = resolverReglas(reglas, { jurisdiccion: 'EC' }); // sin sector
      expect(r.map((x) => x.campoClave)).toEqual(['b']);
    });
  });

  describe('evaluarCumplimiento (asesor, no bloqueante)', () => {
    it('conjunto vacío: cumple true, sin faltantes (reglas inactivas = no exige nada)', () => {
      const r = evaluarCumplimiento([], { cualquiera: 1 });
      expect(r).toMatchObject({ modo: 'ASESOR', cumple: true, totalReglas: 0, faltantes: [], invalidos: [] });
    });

    it('devuelve faltantes sin lanzar cuando faltan campos obligatorios', () => {
      const reglas = resolverReglas(
        [
          base({ sector: 'financiero', campoClave: 'baseLegalTratamiento', descripcion: 'base legal' }),
          base({ sector: 'financiero', campoClave: 'identificadorFiscal', tipoDato: 'TEXTO' }),
        ],
        { sector: 'financiero' },
      );
      const r = evaluarCumplimiento(reglas, { identificadorFiscal: '1790012345001' });
      expect(r.cumple).toBe(false);
      expect(r.faltantes.map((f) => f.campoClave)).toEqual(['baseLegalTratamiento']);
      expect(r.invalidos).toEqual([]);
    });

    it('todos los campos presentes y válidos: cumple true', () => {
      const reglas = resolverReglas([base({ sector: 'retail', campoClave: 'clasificacionDatos', tipoDato: 'TEXTO' })], {
        sector: 'retail',
      });
      const r = evaluarCumplimiento(reglas, { clasificacionDatos: 'interno' });
      expect(r.cumple).toBe(true);
    });

    it('marca invalidos por tipo de dato y por regla declarativa (patrón/enum/rango)', () => {
      const reglas = resolverReglas(
        [
          base({ campoClave: 'edad', tipoDato: 'NUMERO', reglaValidacion: { min: 18, max: 120 } }),
          base({ campoClave: 'clasificacion', tipoDato: 'TEXTO', reglaValidacion: { enum: ['publico', 'interno'] } }),
        ],
        {},
      );
      const r = evaluarCumplimiento(reglas, { edad: 10, clasificacion: 'secreto' });
      expect(r.cumple).toBe(false);
      expect(r.invalidos.map((i) => i.campoClave).sort()).toEqual(['clasificacion', 'edad']);
    });

    it('un campo marcado requerido:false no cuenta como faltante al estar ausente', () => {
      const reglas = resolverReglas([base({ campoClave: 'opcional', reglaValidacion: { requerido: false } })], {});
      const r = evaluarCumplimiento(reglas, {});
      expect(r.cumple).toBe(true);
      expect(r.faltantes).toEqual([]);
    });
  });
});

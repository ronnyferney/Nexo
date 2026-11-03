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

  describe('vigencia por fecha (aditiva, opcional)', () => {
    const DESDE = '2026-01-01T00:00:00.000Z';
    const HASTA = '2026-12-31T23:59:59.999Z';

    it('regla sin vigencia: siempre vigente (reglas ya sembradas no cambian)', () => {
      const reglas = [base({ campoClave: 'siempre' })];
      expect(resolverReglas(reglas, { fechaEvaluacion: '1999-05-01T00:00:00.000Z' })).toHaveLength(1);
      expect(resolverReglas(reglas, { fechaEvaluacion: '2200-05-01T00:00:00.000Z' })).toHaveLength(1);
    });

    it('fecha ANTES del inicio de vigencia: la regla no aplica', () => {
      const reglas = [base({ campoClave: 'futura', vigenciaDesde: DESDE })];
      const r = resolverReglas(reglas, { fechaEvaluacion: '2025-06-01T00:00:00.000Z' });
      expect(r).toEqual([]);
    });

    it('fecha DENTRO de la ventana [desde, hasta]: la regla aplica', () => {
      const reglas = [base({ campoClave: 'vigente', vigenciaDesde: DESDE, vigenciaHasta: HASTA })];
      const r = resolverReglas(reglas, { fechaEvaluacion: '2026-06-15T12:00:00.000Z' });
      expect(r.map((x) => x.campoClave)).toEqual(['vigente']);
    });

    it('fecha DESPUÉS del fin de vigencia: la regla no aplica', () => {
      const reglas = [base({ campoClave: 'expirada', vigenciaHasta: HASTA })];
      const r = resolverReglas(reglas, { fechaEvaluacion: '2027-01-01T00:00:00.000Z' });
      expect(r).toEqual([]);
    });

    it('límites inclusive: exactamente en `desde` y en `hasta` la regla aplica', () => {
      const reglas = [base({ campoClave: 'limite', vigenciaDesde: DESDE, vigenciaHasta: HASTA })];
      expect(resolverReglas(reglas, { fechaEvaluacion: DESDE })).toHaveLength(1);
      expect(resolverReglas(reglas, { fechaEvaluacion: HASTA })).toHaveLength(1);
    });

    it('extremos nulos = sin límite por ese lado', () => {
      const soloDesde = [base({ campoClave: 'abiertaFin', vigenciaDesde: DESDE, vigenciaHasta: null })];
      expect(resolverReglas(soloDesde, { fechaEvaluacion: '2099-01-01T00:00:00.000Z' })).toHaveLength(1);
      expect(resolverReglas(soloDesde, { fechaEvaluacion: '2025-01-01T00:00:00.000Z' })).toEqual([]);

      const soloHasta = [base({ campoClave: 'abiertaInicio', vigenciaDesde: null, vigenciaHasta: HASTA })];
      expect(resolverReglas(soloHasta, { fechaEvaluacion: '1900-01-01T00:00:00.000Z' })).toHaveLength(1);
      expect(resolverReglas(soloHasta, { fechaEvaluacion: '2027-01-01T00:00:00.000Z' })).toEqual([]);
    });

    it('acepta objetos `Date` además de ISO como fecha de evaluación y vigencia', () => {
      const reglas = [base({ campoClave: 'conDate', vigenciaDesde: new Date(DESDE), vigenciaHasta: new Date(HASTA) })];
      expect(resolverReglas(reglas, { fechaEvaluacion: new Date('2026-06-15T12:00:00.000Z') })).toHaveLength(1);
      expect(resolverReglas(reglas, { fechaEvaluacion: new Date('2027-06-15T12:00:00.000Z') })).toEqual([]);
    });

    it('«más específica suma» respeta la vigencia: una regla fuera de ventana cede a la vigente aplicable', () => {
      const reglas = [
        base({ campoClave: 'retencion', descripcion: 'general-vigente' }), // comodín, siempre vigente
        base({
          sector: 'financiero',
          campoClave: 'retencion',
          descripcion: 'financiero-expirada',
          vigenciaHasta: HASTA,
        }),
      ];
      // En 2027 la específica financiera expiró: gana la general (comodín) que sigue vigente.
      const r = resolverReglas(reglas, { sector: 'financiero', fechaEvaluacion: '2027-02-01T00:00:00.000Z' });
      expect(r).toHaveLength(1);
      expect(r[0].descripcion).toBe('general-vigente');
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

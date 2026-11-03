import { resolverRetencion, type PoliticaRetencionPlana } from './retention-policy.resolver';

/**
 * Especificación de la regla PURA de resolución de políticas de retención diferenciadas (P0.2). Invariantes: la política
 * más específica aplicable gana; sin política aplicable rige la retención del workspace (180 d por defecto); un plazo
 * null en la política hereda del workspace; los comodines (canal/tipo null) aplican a todos.
 */
describe('resolverRetencion (políticas diferenciadas)', () => {
  const base = (p: Partial<PoliticaRetencionPlana>): PoliticaRetencionPlana => ({
    canal: null,
    tipoInformacion: null,
    retencionDias: null,
    eliminacionSegura: false,
    consentimientoRequerido: false,
    ...p,
  });

  it('sin políticas: rige la retención del workspace (180 por defecto)', () => {
    const r = resolverRetencion([], 180, { tipoInformacion: 'ORDINARIA' });
    expect(r).toMatchObject({ retencionDias: 180, origen: 'WORKSPACE', politicaAplicada: null });
  });

  it('la política más específica (canal + tipo) gana sobre las más generales', () => {
    const politicas = [
      base({ retencionDias: 365 }), // comodín total
      base({ tipoInformacion: 'EVIDENCIA', retencionDias: 730 }), // por tipo
      base({ canal: 'VOZ', tipoInformacion: 'EVIDENCIA', retencionDias: 1095 }), // canal + tipo (más específica)
    ];
    const r = resolverRetencion(politicas, 180, { canal: 'VOZ', tipoInformacion: 'EVIDENCIA' });
    expect(r.retencionDias).toBe(1095);
    expect(r.origen).toBe('POLITICA');
    expect(r.politicaAplicada).toEqual({ canal: 'VOZ', tipoInformacion: 'EVIDENCIA' });
  });

  it('una política de otro canal no aplica; cae a la más general aplicable', () => {
    const politicas = [
      base({ canal: 'VOZ', tipoInformacion: 'EVIDENCIA', retencionDias: 1095 }),
      base({ tipoInformacion: 'EVIDENCIA', retencionDias: 730 }),
    ];
    const r = resolverRetencion(politicas, 180, { canal: 'CORREO', tipoInformacion: 'EVIDENCIA' });
    expect(r.retencionDias).toBe(730);
    expect(r.politicaAplicada).toEqual({ canal: null, tipoInformacion: 'EVIDENCIA' });
  });

  it('plazo null en la política resuelta hereda del workspace, pero conserva sus banderas', () => {
    const politicas = [
      base({
        tipoInformacion: 'SENSIBLE',
        retencionDias: null,
        eliminacionSegura: true,
        consentimientoRequerido: true,
      }),
    ];
    const r = resolverRetencion(politicas, 180, { tipoInformacion: 'SENSIBLE' });
    expect(r).toMatchObject({
      retencionDias: 180,
      origen: 'WORKSPACE',
      eliminacionSegura: true,
      consentimientoRequerido: true,
      politicaAplicada: { canal: null, tipoInformacion: 'SENSIBLE' },
    });
  });

  it('consulta sin canal: solo aplican políticas con canal comodín (null)', () => {
    const politicas = [
      base({ canal: 'VOZ', retencionDias: 90 }),
      base({ tipoInformacion: 'ORDINARIA', retencionDias: 120 }),
    ];
    const r = resolverRetencion(politicas, 180, { tipoInformacion: 'ORDINARIA' });
    expect(r.retencionDias).toBe(120);
    expect(r.politicaAplicada).toEqual({ canal: null, tipoInformacion: 'ORDINARIA' });
  });

  it('workspace sin límite (null) y sin política aplicable: no purga', () => {
    const r = resolverRetencion([base({ canal: 'VOZ', retencionDias: 30 })], null, { tipoInformacion: 'ORDINARIA' });
    expect(r.retencionDias).toBeNull();
    expect(r.origen).toBe('WORKSPACE');
  });
});

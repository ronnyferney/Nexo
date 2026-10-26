import {
  evaluarRetencion,
  GRABACION_OFF,
  type GrabacionFlags,
  type TipoDatoGrabacion,
} from './grabacion-config.evaluacion';

/**
 * Especificación de la regla PURA de retención (ADR 0015 D3/D4 · decisión Jurídica D7). Verifica los invariantes NO
 * negociables: OFF por defecto, `retencionDias = null` como "pendiente de política" (no un plazo por defecto) y que la
 * eliminación automática solo aplica con plazo definido. Sin plazos legales ni valor probatorio implícitos.
 */
describe('evaluarRetencion (grabación de voz)', () => {
  const TIPOS: TipoDatoGrabacion[] = ['AUDIO', 'TRANSCRIPCION', 'RESUMEN', 'EVIDENCIA'];

  it('config nula o ausente ⇒ todo DESACTIVADO (OFF por defecto), nada permitido, sin plazo', () => {
    for (const tipo of TIPOS) {
      for (const config of [null, undefined, GRABACION_OFF] as const) {
        const r = evaluarRetencion(config, tipo);
        expect(r.permitido).toBe(false);
        expect(r.estado).toBe('DESACTIVADO');
        expect(r.retencionDias).toBeNull();
        expect(r.eliminacionAutomatica).toBe(false);
      }
    }
  });

  it('activar la bandera con retencionDias null ⇒ permitido pero PENDIENTE_POLITICA (no inventa plazo)', () => {
    const config: GrabacionFlags = {
      ...GRABACION_OFF,
      grabarAudio: true,
      guardarTranscripcion: true,
      retencionDias: null,
      eliminacionAutomatica: true, // ignorado sin plazo definido
    };
    const audio = evaluarRetencion(config, 'AUDIO');
    expect(audio.permitido).toBe(true);
    expect(audio.estado).toBe('PENDIENTE_POLITICA');
    expect(audio.retencionDias).toBeNull();
    expect(audio.eliminacionAutomatica).toBe(false);

    // La transcripción (bandera independiente) también queda permitida y pendiente.
    expect(evaluarRetencion(config, 'TRANSCRIPCION').estado).toBe('PENDIENTE_POLITICA');
    // El resumen y la evidencia siguen OFF: banderas independientes.
    expect(evaluarRetencion(config, 'RESUMEN').permitido).toBe(false);
    expect(evaluarRetencion(config, 'EVIDENCIA').permitido).toBe(false);
  });

  it('activar la bandera con retencionDias definido ⇒ DEFINIDO con el plazo y la eliminación configurada', () => {
    const config: GrabacionFlags = {
      ...GRABACION_OFF,
      guardarEvidencia: true,
      retencionDias: 30,
      eliminacionAutomatica: true,
    };
    const r = evaluarRetencion(config, 'EVIDENCIA');
    expect(r.permitido).toBe(true);
    expect(r.estado).toBe('DEFINIDO');
    expect(r.retencionDias).toBe(30);
    expect(r.eliminacionAutomatica).toBe(true);
  });

  it('cada tipo de dato se evalúa con su propia bandera, de forma independiente', () => {
    const config: GrabacionFlags = {
      ...GRABACION_OFF,
      guardarResumen: true,
      retencionDias: 90,
    };
    expect(evaluarRetencion(config, 'RESUMEN').permitido).toBe(true);
    expect(evaluarRetencion(config, 'AUDIO').permitido).toBe(false);
    expect(evaluarRetencion(config, 'TRANSCRIPCION').permitido).toBe(false);
  });
});

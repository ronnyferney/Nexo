import type { ReglaCumplimiento } from '../../core/compliance.models';
import {
  alcanceTexto,
  construirReglaValidacion,
  draftAInput,
  draftDeRegla,
  esObligatoria,
  estadoVigencia,
  estaVigente,
  filtrarReglas,
  formatVigenciaFecha,
  hayFiltrosActivos,
  nuevoDraft,
  parseEnum,
  reglaValidacionResumen,
  valoresDistintos,
  validarDraft,
  vigenciaTexto,
  EMPTY_FILTROS,
} from './cumplimiento.util';

function regla(parcial: Partial<ReglaCumplimiento> = {}): ReglaCumplimiento {
  return {
    id: 'r1',
    workspaceId: 'w1',
    jurisdiccion: null,
    sector: null,
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'baseLegal',
    tipoDato: 'TEXTO',
    reglaValidacion: null,
    controlProteccion: null,
    descripcion: null,
    activa: false,
    vigenciaDesde: null,
    vigenciaHasta: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...parcial,
  };
}

describe('cumplimiento.util', () => {
  it('alcanceTexto usa comodines legibles', () => {
    expect(alcanceTexto(regla())).toContain('Jurisdicción: todas');
    expect(alcanceTexto(regla({ jurisdiccion: 'EC', nivelRiesgo: 'ALTO' }))).toContain('Jurisdicción: EC');
    expect(alcanceTexto(regla({ nivelRiesgo: 'ALTO' }))).toContain('Riesgo: Alto');
  });

  it('esObligatoria: obligatorio salvo requerido:false', () => {
    expect(esObligatoria(regla())).toBe(true);
    expect(esObligatoria(regla({ reglaValidacion: { requerido: false } }))).toBe(false);
    expect(esObligatoria(regla({ reglaValidacion: { requerido: true } }))).toBe(true);
  });

  it('filtrarReglas aplica alcance, estado y texto', () => {
    const reglas = [
      regla({ id: 'a', jurisdiccion: 'EC', activa: true, campoClave: 'consentimiento' }),
      regla({ id: 'b', jurisdiccion: 'CO', activa: false, campoClave: 'baseLegal' }),
    ];
    expect(filtrarReglas(reglas, { ...EMPTY_FILTROS, jurisdiccion: 'EC' }).map((r) => r.id)).toEqual(['a']);
    expect(filtrarReglas(reglas, { ...EMPTY_FILTROS, estado: 'inactiva' }).map((r) => r.id)).toEqual(['b']);
    expect(filtrarReglas(reglas, { ...EMPTY_FILTROS, texto: 'CONSENT' }).map((r) => r.id)).toEqual(['a']);
  });

  it('hayFiltrosActivos distingue vacío de con filtros', () => {
    expect(hayFiltrosActivos(EMPTY_FILTROS)).toBe(false);
    expect(hayFiltrosActivos({ ...EMPTY_FILTROS, estado: 'activa' })).toBe(true);
  });

  it('valoresDistintos ordena y descarta vacíos', () => {
    const reglas = [regla({ sector: 'salud' }), regla({ sector: 'financiero' }), regla({ sector: null })];
    expect(valoresDistintos(reglas, 'sector')).toEqual(['financiero', 'salud']);
  });

  it('parseEnum separa por línea y coma, sin vacíos', () => {
    expect(parseEnum('a\nb, c\n\n')).toEqual(['a', 'b', 'c']);
  });

  it('construirReglaValidacion solo incluye claves con valor', () => {
    const d = { ...nuevoDraft(), requerido: true, min: 1, enumTexto: 'x\ny' };
    const v = construirReglaValidacion(d);
    expect(v.requerido).toBeUndefined();
    expect(v.min).toBe(1);
    expect(v.enum).toEqual(['x', 'y']);
  });

  it('construirReglaValidacion persiste requerido:false', () => {
    const v = construirReglaValidacion({ ...nuevoDraft(), requerido: false });
    expect(v.requerido).toBe(false);
  });

  it('draftAInput convierte alcance vacío a null (comodín)', () => {
    const input = draftAInput({ ...nuevoDraft(), campoClave: ' x ', sector: 'salud' });
    expect(input.campoClave).toBe('x');
    expect(input.jurisdiccion).toBeNull();
    expect(input.sector).toBe('salud');
    expect(input.activa).toBe(false);
  });

  it('draftDeRegla recupera la obligatoriedad y el enum', () => {
    const d = draftDeRegla(regla({ reglaValidacion: { requerido: false, enum: ['a', 'b'] } }));
    expect(d.requerido).toBe(false);
    expect(d.enumTexto).toBe('a\nb');
  });

  it('validarDraft detecta campoClave vacío, patrón inválido y rangos', () => {
    expect(validarDraft({ ...nuevoDraft(), campoClave: '' })).toContain('campo clave');
    expect(validarDraft({ ...nuevoDraft(), campoClave: 'x', patron: '[' })).toContain('patrón');
    expect(validarDraft({ ...nuevoDraft(), campoClave: 'x', min: 5, max: 1 })).toContain('mínimo');
    expect(validarDraft({ ...nuevoDraft(), campoClave: 'x' })).toBeNull();
  });

  it('reglaValidacionResumen describe la regla', () => {
    expect(reglaValidacionResumen(regla())).toBe('Obligatorio');
    expect(reglaValidacionResumen(regla({ reglaValidacion: { requerido: false, min: 2 } }))).toContain('Opcional');
    expect(reglaValidacionResumen(regla({ reglaValidacion: { enum: ['a'] } }))).toContain('enum');
  });

  describe('vigencia', () => {
    const ahora = Date.parse('2026-06-15T12:00:00.000Z');

    it('estadoVigencia: sin límites rige siempre', () => {
      expect(estadoVigencia(regla(), ahora)).toBe('siempre');
      expect(estaVigente(regla(), ahora)).toBe(true);
    });

    it('estadoVigencia: dentro de la ventana es vigente', () => {
      const r = regla({ vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' });
      expect(estadoVigencia(r, ahora)).toBe('vigente');
      expect(estaVigente(r, ahora)).toBe(true);
    });

    it('estadoVigencia: antes del inicio es pendiente', () => {
      const r = regla({ vigenciaDesde: '2026-07-01' });
      expect(estadoVigencia(r, ahora)).toBe('pendiente');
      expect(estaVigente(r, ahora)).toBe(false);
    });

    it('estadoVigencia: después del fin es expirada (hasta inclusive el día)', () => {
      const r = regla({ vigenciaHasta: '2026-05-31' });
      expect(estadoVigencia(r, ahora)).toBe('expirada');
      // Un instante dentro del último día (fecha sin hora) sigue vigente.
      const fin = regla({ vigenciaHasta: '2026-06-15' });
      expect(estadoVigencia(fin, ahora)).toBe('vigente');
    });

    it('vigenciaTexto es legible según los límites presentes', () => {
      expect(vigenciaTexto(regla())).toContain('Sin límite');
      expect(vigenciaTexto(regla({ vigenciaDesde: '2026-01-01' }))).toBe('Desde 01/01/2026');
      expect(vigenciaTexto(regla({ vigenciaHasta: '2026-12-31' }))).toBe('Hasta 31/12/2026');
      expect(vigenciaTexto(regla({ vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' }))).toBe(
        '01/01/2026 – 31/12/2026',
      );
    });

    it('formatVigenciaFecha normaliza fechas con y sin hora', () => {
      expect(formatVigenciaFecha(null)).toBe('');
      expect(formatVigenciaFecha('2026-03-09')).toBe('09/03/2026');
      expect(formatVigenciaFecha('2026-03-09T10:00:00.000Z')).toBe('09/03/2026');
    });

    it('validarDraft detecta vigencia incoherente (desde > hasta)', () => {
      expect(
        validarDraft({ ...nuevoDraft(), campoClave: 'x', vigenciaDesde: '2026-12-31', vigenciaHasta: '2026-01-01' }),
      ).toContain('vigencia');
      expect(
        validarDraft({ ...nuevoDraft(), campoClave: 'x', vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' }),
      ).toBeNull();
    });

    it('draftAInput envía null cuando la vigencia está vacía y la fecha cuando se indica', () => {
      expect(draftAInput({ ...nuevoDraft(), campoClave: 'x' }).vigenciaDesde).toBeNull();
      const input = draftAInput({ ...nuevoDraft(), campoClave: 'x', vigenciaDesde: '2026-01-01' });
      expect(input.vigenciaDesde).toBe('2026-01-01');
      expect(input.vigenciaHasta).toBeNull();
    });

    it('draftDeRegla recupera la vigencia como valor de input date', () => {
      const d = draftDeRegla(regla({ vigenciaDesde: '2026-01-01T00:00:00.000Z', vigenciaHasta: null }));
      expect(d.vigenciaDesde).toBe('2026-01-01');
      expect(d.vigenciaHasta).toBe('');
    });
  });
});

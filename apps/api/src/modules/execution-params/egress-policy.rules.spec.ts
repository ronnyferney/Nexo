import { puedeConectarSistemasAutorizados, puedeNavegarWeb } from './egress-policy.rules';

describe('Gobierno de la salida a internet segmentado (E8 · reglas puras)', () => {
  describe('puedeConectarSistemasAutorizados', () => {
    it('bloquea cuando sistemasAutorizados es false', () => {
      expect(puedeConectarSistemasAutorizados({ navegacionWeb: true, sistemasAutorizados: false })).toBe(false);
    });

    it('habilita cuando sistemasAutorizados es true', () => {
      expect(puedeConectarSistemasAutorizados({ navegacionWeb: false, sistemasAutorizados: true })).toBe(true);
    });
  });

  describe('puedeNavegarWeb', () => {
    it('bloquea cuando navegacionWeb es false', () => {
      expect(puedeNavegarWeb({ navegacionWeb: false, sistemasAutorizados: true })).toBe(false);
    });

    it('habilita cuando navegacionWeb es true', () => {
      expect(puedeNavegarWeb({ navegacionWeb: true, sistemasAutorizados: false })).toBe(true);
    });
  });

  it('las categorías son independientes entre sí', () => {
    const p = { navegacionWeb: true, sistemasAutorizados: false };
    expect(puedeNavegarWeb(p)).toBe(true);
    expect(puedeConectarSistemasAutorizados(p)).toBe(false);
  });
});

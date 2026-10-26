import { puedeSalirAInternet } from './egress-policy.rules';

describe('Gobierno de la salida a internet (E8 · reglas puras)', () => {
  it('bloquea el egress cuando salidaInternet es false', () => {
    expect(puedeSalirAInternet({ salidaInternet: false })).toBe(false);
  });

  it('habilita el egress cuando salidaInternet es true', () => {
    expect(puedeSalirAInternet({ salidaInternet: true })).toBe(true);
  });
});

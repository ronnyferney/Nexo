import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExecutionParamsService } from './execution-params.service';

/**
 * Gate de egress (E8): `assertSalidaInternetPermitida` bloquea cuando `salidaInternet = false` y permite cuando es
 * `true`. Es un gate ADICIONAL: cuando permite, la llamada saliente sigue pasando por `HttpClientService`.
 */
describe('ExecutionParamsService · gate de salida a internet (E8)', () => {
  function build(agent: { salidaInternet: boolean; estacionVirtualId?: string | null } | null) {
    const prisma = { agent: { findFirst: jest.fn().mockResolvedValue(agent) } };
    const service = new ExecutionParamsService(
      prisma as never,
      { append: jest.fn() } as never,
      { assertInWorkspace: jest.fn() } as never,
    );
    return { service, prisma };
  }

  it('bloquea el egress (Forbidden) cuando salidaInternet = false', async () => {
    const { service } = build({ salidaInternet: false });
    await expect(service.assertSalidaInternetPermitida('ws1', 'ag1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite el egress cuando salidaInternet = true', async () => {
    const { service } = build({ salidaInternet: true });
    await expect(service.assertSalidaInternetPermitida('ws1', 'ag1')).resolves.toBeUndefined();
  });

  it('404 cuando el agente no existe en el workspace', async () => {
    const { service } = build(null);
    await expect(service.assertSalidaInternetPermitida('ws1', 'ag1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // Variante de lectura para el runtime (E8-2): el candado es una propiedad de la estación virtual asignada.
  describe('puedeSalirAInternet (lectura del runtime)', () => {
    it('bloquea (false) solo con estación asignada y salidaInternet = false', async () => {
      const { service } = build({ estacionVirtualId: 'est1', salidaInternet: false });
      await expect(service.puedeSalirAInternet('ws1', 'ag1')).resolves.toBe(false);
    });

    it('permite (true) con estación asignada y salidaInternet = true', async () => {
      const { service } = build({ estacionVirtualId: 'est1', salidaInternet: true });
      await expect(service.puedeSalirAInternet('ws1', 'ag1')).resolves.toBe(true);
    });

    it('sin estación: comportamiento heredado (permite) aunque salidaInternet = false', async () => {
      const { service } = build({ estacionVirtualId: null, salidaInternet: false });
      await expect(service.puedeSalirAInternet('ws1', 'ag1')).resolves.toBe(true);
    });

    it('agente inexistente: no hay estación visible, se trata como vía heredada (permite)', async () => {
      const { service } = build(null);
      await expect(service.puedeSalirAInternet('ws1', 'ag1')).resolves.toBe(true);
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExecutionParamsService } from './execution-params.service';

/**
 * Gate de egress (E8): `assertSalidaInternetPermitida` bloquea cuando `salidaInternet = false` y permite cuando es
 * `true`. Es un gate ADICIONAL: cuando permite, la llamada saliente sigue pasando por `HttpClientService`.
 */
describe('ExecutionParamsService · gate de salida a internet (E8)', () => {
  function build(agent: { salidaInternet: boolean } | null) {
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
});

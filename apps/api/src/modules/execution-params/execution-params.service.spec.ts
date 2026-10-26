import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExecutionParamsService } from './execution-params.service';

/**
 * Gate de egress segmentado (E8 · corrección Opción A):
 *  - `assertSistemasAutorizadosPermitido` bloquea (Forbidden) cuando `sistemasAutorizados = false`.
 *  - `puedeConectarSistemasAutorizados`/`puedeNavegarWeb` son lecturas del runtime SIN excepción.
 * CIERRE DE LA ELUSIÓN: la política aplica CON O SIN estación asignada; un agente inexistente DENIEGA por seguridad.
 * Es un gate ADICIONAL: cuando permite, la llamada saliente sigue pasando por `HttpClientService`.
 */
describe('ExecutionParamsService · candado de salida a internet segmentado (E8)', () => {
  type AgentShape = { navegacionWeb: boolean; sistemasAutorizados: boolean; estacionVirtualId?: string | null } | null;
  function build(agent: AgentShape) {
    const prisma = { agent: { findFirst: jest.fn().mockResolvedValue(agent) } };
    const service = new ExecutionParamsService(
      prisma as never,
      { append: jest.fn() } as never,
      { assertInWorkspace: jest.fn() } as never,
    );
    return { service, prisma };
  }

  describe('assertSistemasAutorizadosPermitido', () => {
    it('bloquea (Forbidden) cuando sistemasAutorizados = false', async () => {
      const { service } = build({ navegacionWeb: true, sistemasAutorizados: false });
      await expect(service.assertSistemasAutorizadosPermitido('ws1', 'ag1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permite cuando sistemasAutorizados = true', async () => {
      const { service } = build({ navegacionWeb: false, sistemasAutorizados: true });
      await expect(service.assertSistemasAutorizadosPermitido('ws1', 'ag1')).resolves.toBeUndefined();
    });

    it('404 cuando el agente no existe en el workspace', async () => {
      const { service } = build(null);
      await expect(service.assertSistemasAutorizadosPermitido('ws1', 'ag1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('puedeConectarSistemasAutorizados (lectura del runtime)', () => {
    it('bloquea (false) con sistemasAutorizados = false, CON estación', async () => {
      const { service } = build({ estacionVirtualId: 'est1', navegacionWeb: false, sistemasAutorizados: false });
      await expect(service.puedeConectarSistemasAutorizados('ws1', 'ag1')).resolves.toBe(false);
    });

    it('permite (true) con sistemasAutorizados = true, CON estación', async () => {
      const { service } = build({ estacionVirtualId: 'est1', navegacionWeb: false, sistemasAutorizados: true });
      await expect(service.puedeConectarSistemasAutorizados('ws1', 'ag1')).resolves.toBe(true);
    });

    it('CIERRE DE ELUSIÓN: SIN estación y sistemasAutorizados = false → bloquea (false)', async () => {
      const { service } = build({ estacionVirtualId: null, navegacionWeb: false, sistemasAutorizados: false });
      await expect(service.puedeConectarSistemasAutorizados('ws1', 'ag1')).resolves.toBe(false);
    });

    it('SIN estación y sistemasAutorizados = true → permite (true)', async () => {
      const { service } = build({ estacionVirtualId: null, navegacionWeb: false, sistemasAutorizados: true });
      await expect(service.puedeConectarSistemasAutorizados('ws1', 'ag1')).resolves.toBe(true);
    });

    it('agente inexistente: DENIEGA por seguridad (false)', async () => {
      const { service } = build(null);
      await expect(service.puedeConectarSistemasAutorizados('ws1', 'ag1')).resolves.toBe(false);
    });
  });

  describe('puedeNavegarWeb (lectura del runtime)', () => {
    it('refleja solo la categoría navegacionWeb, independiente de sistemasAutorizados', async () => {
      const { service } = build({ estacionVirtualId: null, navegacionWeb: true, sistemasAutorizados: false });
      await expect(service.puedeNavegarWeb('ws1', 'ag1')).resolves.toBe(true);
    });

    it('agente inexistente: DENIEGA por seguridad (false)', async () => {
      const { service } = build(null);
      await expect(service.puedeNavegarWeb('ws1', 'ag1')).resolves.toBe(false);
    });
  });
});

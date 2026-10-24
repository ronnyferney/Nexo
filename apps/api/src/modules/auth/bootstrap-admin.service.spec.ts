import { ConflictException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from './auth.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BootstrapAdminService } from './bootstrap-admin.service';

const cfg = { email: 'admin@nexo.co', password: 'una-clave-larga-y-segura', name: 'Admin', workspaceName: 'Nexo' };

function make(createAccount: jest.Mock, prisma: unknown = {}) {
  return new BootstrapAdminService(
    { createAccount } as unknown as AuthService,
    {} as ConfigService,
    prisma as PrismaService,
  );
}

describe('BootstrapAdminService', () => {
  it('crea el usuario maestro como dueño del workspace inicial, con el correo verificado', async () => {
    const register = jest.fn().mockResolvedValue({});
    await expect(make(register).ensure(cfg)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith(
      { email: 'admin@nexo.co', password: cfg.password, name: 'Admin', workspaceName: 'Nexo' },
      { verified: true },
    );
  });

  it('advierte por cada correo de PLATFORM_ADMIN_EMAILS sin cuenta verificada (A7)', async () => {
    const findMany = jest
      .fn<Promise<{ email: string }[]>, [{ where: Record<string, unknown> }]>()
      .mockResolvedValue([{ email: 'ok@nexo.co' }]);
    const service = make(jest.fn(), { user: { findMany } });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(
      service.warnUnverifiedPlatformAdmins(['ok@nexo.co', 'falta@nexo.co', 'sinverificar@nexo.co']),
    ).resolves.toEqual(['falta@nexo.co', 'sinverificar@nexo.co']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ emailVerifiedAt: { not: null } });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('f***@nexo.co');
    warn.mockRestore();
  });

  it('no hace nada sin correo o contraseña', async () => {
    const register = jest.fn();
    await expect(make(register).ensure({ ...cfg, password: null })).resolves.toBe(false);
    await expect(make(register).ensure({ ...cfg, email: null })).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('rechaza contraseñas cortas', async () => {
    const register = jest.fn();
    await expect(make(register).ensure({ ...cfg, password: 'corta' })).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('si ya existe (o otra réplica lo creó a la vez) no cambia nada', async () => {
    await expect(make(jest.fn().mockRejectedValue(new ConflictException())).ensure(cfg)).resolves.toBe(false);
    await expect(make(jest.fn().mockRejectedValue({ code: 'P2002' })).ensure(cfg)).resolves.toBe(false);
  });

  it('propaga otros errores', async () => {
    await expect(make(jest.fn().mockRejectedValue(new Error('bd caída'))).ensure(cfg)).rejects.toThrow('bd caída');
  });
});

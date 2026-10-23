import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService } from './auth.service';
import { BootstrapAdminService } from './bootstrap-admin.service';

const cfg = { email: 'admin@nexo.co', password: 'una-clave-larga-y-segura', name: 'Admin', workspaceName: 'Nexo' };

function make(register: jest.Mock) {
  return new BootstrapAdminService({ register } as unknown as AuthService, {} as ConfigService);
}

describe('BootstrapAdminService', () => {
  it('crea el usuario maestro como dueño del workspace inicial', async () => {
    const register = jest.fn().mockResolvedValue({});
    await expect(make(register).ensure(cfg)).resolves.toBe(true);
    expect(register).toHaveBeenCalledWith({
      email: 'admin@nexo.co',
      password: cfg.password,
      name: 'Admin',
      workspaceName: 'Nexo',
    });
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

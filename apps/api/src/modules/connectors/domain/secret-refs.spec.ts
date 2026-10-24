import { ConnectorsService } from '../connectors.service';
import {
  assertSecretRefsAllowed,
  collectSecretRefs,
  destinationFingerprint,
  disallowedSecretRefs,
  SecretNotAllowedException,
} from './secret-refs';
import type { ConnectorRuntime, InvocationResult } from './connector.types';

describe('collectSecretRefs', () => {
  it('extrae nombres de cadenas, arreglos y objetos anidados, sin duplicados', () => {
    const refs = collectSecretRefs(
      { baseUrl: 'https://api.example.com', headers: { 'x-key': '{{ secrets.CRM_TOKEN }}' } },
      { type: 'basic', username: '{{secrets.USR}}', password: 'p-{{ secrets.PASS | trim }}-x' },
      { body: [{ token: '{{ secrets.CRM_TOKEN }}' }] },
    );
    expect(refs).toEqual({ names: ['CRM_TOKEN', 'PASS', 'USR'], wholeVault: false });
  });

  it('normaliza las mismas variantes de ruta que el motor de plantillas', () => {
    expect(collectSecretRefs('{{ secrets[OTRO] }}').names).toEqual(['OTRO']);
    expect(collectSecretRefs('{{ .secrets.OTRO }}').names).toEqual(['OTRO']);
    expect(collectSecretRefs('{{ secrets..OTRO.extra }}').names).toEqual(['OTRO']);
  });

  it('detecta el uso de la bóveda completa', () => {
    expect(collectSecretRefs('{{ secrets | json }}').wholeVault).toBe(true);
    expect(collectSecretRefs({ h: 'a {{ secrets }} b' }).wholeVault).toBe(true);
  });

  it('ignora otras rutas y literales', () => {
    expect(collectSecretRefs('{{ input.secrets.X }}', "{{ 'secrets.X' }}", '{{ input.id | default:secrets }}')).toEqual(
      {
        names: [],
        wholeVault: false,
      },
    );
    expect(collectSecretRefs(undefined, null, 42, true)).toEqual({ names: [], wholeVault: false });
  });
});

describe('assertSecretRefsAllowed', () => {
  it('devuelve los nombres si todos están permitidos', () => {
    expect(assertSecretRefsAllowed(collectSecretRefs('{{ secrets.A1 }}'), ['A1', 'B1'])).toEqual(['A1']);
  });

  it('rechaza con 403 y mensaje en español los no permitidos', () => {
    const refs = collectSecretRefs('{{ secrets.A1 }} {{ secrets.ADMIN_DB_PASSWORD }}');
    expect(disallowedSecretRefs(refs, ['A1'])).toEqual(['ADMIN_DB_PASSWORD']);
    expect(() => assertSecretRefsAllowed(refs, ['A1'])).toThrow(SecretNotAllowedException);
    try {
      assertSecretRefsAllowed(refs, ['A1']);
    } catch (err) {
      expect((err as SecretNotAllowedException).getStatus()).toBe(403);
      expect((err as Error).message).toMatch(/secretos no permitidos: ADMIN_DB_PASSWORD.*Secretos permitidos/);
    }
  });

  it('la bóveda completa nunca se permite, aunque la lista tenga nombres', () => {
    expect(() => assertSecretRefsAllowed(collectSecretRefs('{{ secrets | json }}'), ['A1'])).toThrow(/bóveda completa/);
  });
});

describe('ConnectorsService: secretos permitidos por conector (A4)', () => {
  const vault: Record<string, string> = { CRM_TOKEN: 'crm-valor', ADMIN_DB_PASSWORD: 'super-secreto' };
  const build = (connectorOverrides: Record<string, unknown> = {}) => {
    const connector = {
      id: 'c1',
      workspaceId: 'w1',
      type: 'REST',
      config: { baseUrl: 'https://api.example.com' },
      auth: { type: 'bearer', token: '{{ secrets.CRM_TOKEN }}' },
      allowedSecrets: ['CRM_TOKEN'],
      operations: [],
      ...connectorOverrides,
    };
    const adapter = {
      type: 'REST',
      invoke: jest
        .fn<Promise<InvocationResult>, [ConnectorRuntime, unknown, unknown]>()
        .mockResolvedValue({ ok: true, data: {}, durationMs: 1 }),
    };
    const prisma = {
      connector: {
        findFirst: jest.fn().mockResolvedValue(connector),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'c2', ...data })),
        update: jest
          .fn<Promise<typeof connector>, [{ where: unknown; data: Record<string, unknown> }]>()
          .mockResolvedValue(connector),
      },
      connectorOperation: { create: jest.fn().mockResolvedValue({}) },
    };
    const secrets = {
      resolveMany: jest.fn((_ws: string, names: string[]) =>
        Promise.resolve(Object.fromEntries(names.filter((n) => n in vault).map((n) => [n, vault[n]]))),
      ),
    };
    const service = new ConnectorsService(prisma as never, secrets as never, [adapter as never]);
    const op = (definition: Record<string, unknown>) =>
      ({
        id: `op-${Math.random()}`,
        key: 'op',
        updatedAt: new Date(),
        definition,
        inputSchema: { type: 'object' },
        connector,
      }) as never;
    return { service, adapter, prisma, secrets, op };
  };
  const editor = { workspaceId: 'w1', role: 'EDITOR', via: 'jwt' } as const;
  const apiKey = { workspaceId: 'w1', role: 'EDITOR', via: 'apiKey' } as const;
  const admin = { workspaceId: 'w1', role: 'ADMIN', via: 'jwt' } as const;

  it('solo descifra los secretos referenciados y permitidos', async () => {
    const { service, adapter, secrets, op } = build();
    await service.invoke(op({ method: 'GET', path: '/x' }), {});
    expect(secrets.resolveMany).toHaveBeenCalledWith('w1', ['CRM_TOKEN']);
    expect(adapter.invoke.mock.calls[0][0].secrets).toEqual({ CRM_TOKEN: 'crm-valor' });
  });

  it('una operación que referencia un secreto ajeno se bloquea antes de leer la bóveda', async () => {
    const { service, adapter, secrets, op } = build();
    const def = { method: 'GET', path: '/x', headers: { 'x-leak': '{{ secrets.ADMIN_DB_PASSWORD }}' } };
    await expect(service.invoke(op(def), {})).rejects.toThrow(/no permitidos: ADMIN_DB_PASSWORD/);
    expect(secrets.resolveMany).not.toHaveBeenCalled();
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('el mismo error para un secreto que no existe (no revela existencia)', async () => {
    const { service, op } = build();
    const msg = (name: string) =>
      service
        .invoke(op({ method: 'GET', path: '/x', headers: { h: `{{ secrets.${name} }}` } }), {})
        .catch((e: Error) => e.message.replace(name, 'X'));
    expect(await msg('ADMIN_DB_PASSWORD')).toBe(await msg('NO_EXISTE'));
  });

  it.each([
    ['EDITOR', editor],
    ['API key', apiKey],
  ])('un %s crea el conector sin secretos permitidos y la referencia queda bloqueada', async (_l, who) => {
    const { service, prisma } = build();
    const created = await service.create(who, {
      name: 'Exfiltrar',
      type: 'REST',
      config: { baseUrl: 'https://atacante.example', headers: { h: '{{ secrets.ADMIN_DB_PASSWORD }}' } },
    } as never);
    expect(prisma.connector.create.mock.calls[0][0].data.allowedSecrets).toEqual([]);
    expect(created.blockedSecrets).toEqual(['ADMIN_DB_PASSWORD']);
  });

  it('un ADMIN que crea el conector permite las referencias que escribió', async () => {
    const { service, prisma } = build();
    await service.create(admin, {
      name: 'CRM',
      type: 'REST',
      config: { baseUrl: 'https://crm.example' },
      auth: { type: 'bearer', token: '{{ secrets.CRM_TOKEN }}' },
    } as never);
    expect(prisma.connector.create.mock.calls[0][0].data.allowedSecrets).toEqual(['CRM_TOKEN']);
  });

  it('un EDITOR que edita la configuración no amplía la lista', async () => {
    const { service, prisma } = build();
    await service.update(editor, 'c1', {
      config: { baseUrl: 'https://api.example.com', headers: { h: '{{ secrets.OTRO }}' } },
    });
    expect(prisma.connector.update.mock.calls[0][0].data.allowedSecrets).toBeUndefined();
  });

  it('un EDITOR no puede redirigir a otro servidor un conector con secretos permitidos; un ADMIN sí', async () => {
    const { service, prisma } = build();
    await expect(service.update(editor, 'c1', { config: { baseUrl: 'https://atacante.example' } })).rejects.toThrow(
      /Solo un administrador puede cambiar el destino/,
    );
    expect(prisma.connector.update).not.toHaveBeenCalled();
    await service.update(admin, 'c1', { config: { baseUrl: 'https://nuevo.example' } });
    expect(prisma.connector.update).toHaveBeenCalled();
  });

  it('sin secretos permitidos, un EDITOR cambia el destino libremente', async () => {
    const { service, prisma } = build({ allowedSecrets: [] });
    await service.update(editor, 'c1', { config: { baseUrl: 'https://otro.example' } });
    expect(prisma.connector.update).toHaveBeenCalled();
  });

  it('un ADMIN que guarda una referencia dejada por un EDITOR no la aprueba sin querer', async () => {
    const planted = { baseUrl: 'https://x', headers: { h: '{{ secrets.OTRO }}' } };
    const { service, prisma } = build({ config: planted });
    await service.update(admin, 'c1', { name: 'Renombrado', config: planted });
    expect(prisma.connector.update.mock.calls[0][0].data.allowedSecrets).toEqual(['CRM_TOKEN']);
    await service.update(admin, 'c1', { config: { ...planted, extra: '{{ secrets.NUEVO_ADMIN }}' } });
    expect(prisma.connector.update.mock.calls[1][0].data.allowedSecrets).toEqual(['CRM_TOKEN', 'NUEVO_ADMIN']);
  });

  it('una operación creada por un EDITOR no amplía la lista; la de un ADMIN sí', async () => {
    const { service, prisma } = build();
    const dto = { key: 'k', name: 'K', definition: { headers: { h: '{{ secrets.OTRO }}' } } };
    await service.createOperation(editor, 'c1', dto);
    expect(prisma.connector.update).not.toHaveBeenCalled();
    await service.createOperation(admin, 'c1', dto);
    expect(prisma.connector.update.mock.calls[0][0].data.allowedSecrets).toEqual(['CRM_TOKEN', 'OTRO']);
  });

  it('el detalle informa referencias y bloqueadas sin consultar la bóveda', async () => {
    const { service, secrets } = build({
      operations: [{ definition: { headers: { h: '{{ secrets.OTRO }}' } } }],
    });
    const detail = await service.detail('w1', 'c1');
    expect(detail.secretReferences).toEqual(['CRM_TOKEN', 'OTRO']);
    expect(detail.blockedSecrets).toEqual(['OTRO']);
    expect(secrets.resolveMany).not.toHaveBeenCalled();
  });

  it('probar un conector con un secreto bloqueado responde ok:false con el motivo', async () => {
    const { service } = build({ allowedSecrets: [] });
    const result = await service.test('w1', 'c1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no permitidos: CRM_TOKEN/);
  });
});

describe('destinationFingerprint', () => {
  it('cambia con la URL base, el host de BD o las URLs OAuth, no con headers ni el nombre', () => {
    const base = destinationFingerprint({ baseUrl: 'https://a', headers: { h: '1' } }, { type: 'bearer', token: 't' });
    expect(destinationFingerprint({ baseUrl: 'https://a', headers: { h: '2' } }, { type: 'bearer', token: 'x' })).toBe(
      base,
    );
    expect(destinationFingerprint({ baseUrl: 'https://atacante' }, { type: 'bearer' })).not.toBe(base);
    expect(destinationFingerprint({ host: 'db1', port: 5432 }, {})).not.toBe(
      destinationFingerprint({ host: 'db2' }, {}),
    );
    expect(destinationFingerprint({}, { tokenUrl: 'https://idp/token' })).not.toBe(destinationFingerprint({}, {}));
  });

  it('no depende del orden de las claves (jsonb lo reordena)', () => {
    expect(destinationFingerprint({}, { accountLabel: { url: 'u', path: 'p' } })).toBe(
      destinationFingerprint({}, { accountLabel: { path: 'p', url: 'u' } }),
    );
  });
});

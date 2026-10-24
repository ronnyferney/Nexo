import {
  isPrivateAddress,
  NetworkPolicyError,
  pinnedLookup,
  resolvePublicAddresses,
  type ResolvedAddress,
} from './network-policy';

describe('isPrivateAddress (A3: normalización con BlockList)', () => {
  it.each([
    // IPv4 internas, reservadas y de metadatos
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.100.100.200',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '169.254.170.2',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.192',
    '192.168.1.10',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '168.63.129.16',
    // IPv6 loopback / no especificada / IPv4 compatible
    '::1',
    '::',
    '::7f00:1',
    // IPv4 mapeada, en notación decimal y hexadecimal (el bypass del informe)
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '::ffff:10.1.1.1',
    '::ffff:8.8.8.8',
    // NAT64, 6to4, Teredo
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b:1::1',
    '2002:7f00:1::1',
    '2002:a9fe:a9fe::',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    // ULA, link-local, site-local, multicast, documentación
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'fe80::1%eth0',
    'febf::1',
    'fec0::1',
    'feff::1',
    'ff02::1',
    '2001:db8::1',
    '[::1]',
  ])('%s está bloqueada', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
    '2001:4860:4860::8888',
  ])('%s es pública', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('falla cerrado ante algo que no es una IP', () => {
    expect(isPrivateAddress('localhost')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('7f00:1')).toBe(true);
  });
});

describe('resolvePublicAddresses', () => {
  const resolver = (list: string[]) => jest.fn(async () => list.map((address) => ({ address, family: 4 as const })));

  it('valida IP literales sin resolver', async () => {
    const r = resolver([]);
    await expect(resolvePublicAddresses('[::ffff:7f00:1]', r)).rejects.toBeInstanceOf(NetworkPolicyError);
    await expect(resolvePublicAddresses('8.8.8.8', r)).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(r).not.toHaveBeenCalled();
  });

  it('rechaza el nombre si UNA de sus direcciones es interna (registro mixto)', async () => {
    await expect(resolvePublicAddresses('mixto.example', resolver(['8.8.8.8', '10.0.0.5']))).rejects.toThrow(
      'Destino bloqueado por política de red: mixto.example',
    );
  });

  it('devuelve las direcciones validadas para fijarlas en la conexión', async () => {
    await expect(resolvePublicAddresses('ok.example', resolver(['1.1.1.1']))).resolves.toEqual([
      { address: '1.1.1.1', family: 4 },
    ]);
  });

  it('un fallo de DNS es un error claro, no un permiso', async () => {
    const failing = jest.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'ENOTFOUND' });
    });
    await expect(resolvePublicAddresses('no-existe.example', failing)).rejects.toThrow(/ENOTFOUND/);
  });
});

describe('pinnedLookup', () => {
  const addrs: ResolvedAddress[] = [
    { address: '93.184.215.14', family: 4 },
    { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
  ];
  const call = (options: object) =>
    new Promise<unknown[]>((resolve) =>
      (pinnedLookup(addrs) as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)(
        'cualquier-nombre.example',
        options,
        (...args) => resolve(args),
      ),
    );

  it('ignora el nombre y devuelve la IP validada (forma simple y `all`)', async () => {
    expect(await call({})).toEqual([null, '93.184.215.14', 4]);
    expect(await call({ all: true })).toEqual([null, addrs]);
    expect(await call({ family: 6 })).toEqual([null, addrs[1].address, 6]);
  });

  it('sin dirección para la familia pedida responde ENOTFOUND (nunca resuelve por su cuenta)', async () => {
    const only4 = pinnedLookup([addrs[0]]) as unknown as (h: string, o: object, cb: (e: unknown) => void) => void;
    const err = await new Promise((resolve) => only4('x', { family: 6 }, resolve));
    expect(err).toMatchObject({ code: 'ENOTFOUND' });
  });
});

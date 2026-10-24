import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * Política de red saliente (protección SSRF) compartida por `HttpClientService`, el SDK MCP y los drivers de base
 * de datos. Dos piezas:
 *
 * 1. `isPrivateAddress()`: decide con `net.BlockList` si una IP es interna. `BlockList` normaliza la IP (no compara
 *    texto), de modo que `::ffff:7f00:1`, `::ffff:127.0.0.1` y `0:0:0:0:0:ffff:7f00:1` se tratan igual.
 * 2. `resolvePublicAddresses()` + `pinnedLookup()`: se resuelve el nombre UNA sola vez, se validan todas las
 *    direcciones y la conexión se abre contra esas mismas IP (sin segunda resolución DNS). Así se elimina el TOCTOU
 *    de «validar un nombre y luego dejar que el cliente lo resuelva otra vez» (DNS rebinding).
 */

/** Dirección resuelta y validada. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolutor de nombres inyectable (en producción, `dns.lookup` con `all: true`). */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultHostResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => ({
    address: a.address,
    family: a.family === 6 ? 6 : 4,
  }));

/** Error de política de red: el mensaje nunca incluye credenciales, solo el host. */
export class NetworkPolicyError extends Error {
  constructor(hostname: string) {
    super(`Destino bloqueado por política de red: ${hostname}`);
    this.name = 'NetworkPolicyError';
  }
}

const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // «esta red»; 0.0.0.0 llega a loopback en Linux
  ['10.0.0.0', 8], // privada (RFC 1918)
  ['100.64.0.0', 10], // CGNAT (RFC 6598); incluye metadatos de Alibaba 100.100.100.200
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local; metadatos AWS/GCP/Azure 169.254.169.254, ECS 169.254.170.2
  ['172.16.0.0', 12], // privada (RFC 1918)
  ['192.0.0.0', 24], // asignaciones IETF; metadatos de Oracle Cloud 192.0.0.192
  ['192.0.2.0', 24], // documentación TEST-NET-1
  ['192.88.99.0', 24], // relé 6to4 (obsoleto)
  ['192.168.0.0', 16], // privada (RFC 1918)
  ['198.18.0.0', 15], // pruebas de rendimiento
  ['198.51.100.0', 24], // documentación TEST-NET-2
  ['203.0.113.0', 24], // documentación TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada y 255.255.255.255 (broadcast)
];
const IPV4_BLOCKED_HOSTS = ['168.63.129.16']; // Azure WireServer / IMDS alternativo

const IPV6_BLOCKED: Array<[string, number]> = [
  ['::', 96], // no especificada (::), loopback (::1) e IPv4 compatible (obsoleta)
  ['::ffff:0:0', 96], // IPv4 mapeada (::ffff:7f00:1 = 127.0.0.1)
  ['64:ff9b::', 96], // NAT64 bien conocido (64:ff9b::7f00:1 traduce a 127.0.0.1)
  ['64:ff9b:1::', 48], // NAT64 local
  ['100::', 64], // descarte
  ['2001::', 32], // Teredo (encapsula una IPv4 arbitraria)
  ['2001:db8::', 32], // documentación
  ['2002::', 16], // 6to4 (2002:7f00:1:: encapsula 127.0.0.1)
  ['fc00::', 7], // ULA; incluye metadatos de AWS fd00:ec2::254
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (obsoleta, aún enrutable en algunas redes)
  ['ff00::', 8], // multicast
];

// Listas separadas: `BlockList` compara una IPv4 también contra las reglas IPv6 en su forma mapeada (`::ffff:a.b.c.d`),
// y la regla `::ffff:0:0/96` bloquearía entonces cualquier IPv4.
const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED) BLOCKED_V4.addSubnet(net, prefix, 'ipv4');
for (const host of IPV4_BLOCKED_HOSTS) BLOCKED_V4.addAddress(host, 'ipv4');
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of IPV6_BLOCKED) BLOCKED_V6.addSubnet(net, prefix, 'ipv6');

/** Quita corchetes (`[::1]`) y el identificador de zona (`fe80::1%eth0`). */
function normalizeIp(raw: string): string {
  return raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
}

/**
 * `true` si la IP pertenece a un rango interno, reservado o de metadatos cloud. Cualquier valor que no sea una IP
 * válida se considera bloqueado (falla cerrado).
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = normalizeIp(ip);
  const family = isIP(addr);
  if (family === 4) return BLOCKED_V4.check(addr, 'ipv4');
  if (family === 6) return BLOCKED_V6.check(addr, 'ipv6');
  return true;
}

/**
 * Resuelve `hostname` una sola vez y exige que TODAS las direcciones sean públicas (si una sola es interna se rechaza:
 * evita que un registro DNS mixto sirva de puente). Devuelve las direcciones validadas para fijarlas en la conexión.
 */
export async function resolvePublicAddresses(
  hostname: string,
  resolver: HostResolver = defaultHostResolver,
): Promise<ResolvedAddress[]> {
  const host = normalizeIp(hostname);
  if (!host) throw new NetworkPolicyError(hostname);
  const family = isIP(host);
  let addresses: ResolvedAddress[];
  if (family) {
    addresses = [{ address: host, family: family === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolver(host);
    } catch (err) {
      throw new Error(
        `No se pudo resolver ${hostname}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`,
      );
    }
  }
  if (!addresses.length) throw new Error(`No se pudo resolver ${hostname}`);
  for (const a of addresses) if (isPrivateAddress(a.address)) throw new NetworkPolicyError(hostname);
  return addresses;
}

/**
 * `lookup` para `net`/`tls`/`http(s)` que ignora el DNS y devuelve las IP ya validadas. El nombre original se sigue
 * usando para SNI, verificación del certificado y cabecera `Host`.
 */
export function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return ((_hostname: string, options: { all?: boolean; family?: number | string }, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void;
    const opts = typeof options === 'object' && options ? options : {};
    const wanted =
      opts.family === 4 || opts.family === 'IPv4' ? 4 : opts.family === 6 || opts.family === 'IPv6' ? 6 : 0;
    const list = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
    if (!list.length) {
      const err: NodeJS.ErrnoException = new Error('Sin direcciones validadas para la familia solicitada');
      err.code = 'ENOTFOUND';
      cb(err, '', 0);
      return;
    }
    if (opts.all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  }) as LookupFunction;
}

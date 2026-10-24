import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { serializeContext, type CipherContext } from './cipher-context';
import { LEGACY_KID, parseKeyring, type EncryptionKeyring } from './keyring';

/** Prefijo del formato versionado. Un valor legacy es base64 puro y nunca contiene `:`. */
const V2 = 'v2';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Valor cifrado que no se pudo descifrar (clave desconocida, contexto distinto o datos alterados). Sin detalles. */
export class DecryptionError extends Error {
  constructor(reason: string) {
    super(`No se pudo descifrar el valor: ${reason}`);
    this.name = 'DecryptionError';
  }
}

/**
 * Cifrado simétrico AES-256-GCM de credenciales (bóveda, conexiones LLM, tokens OAuth, `state`). Auditoría B7.
 *
 * Formato vigente: `v2:<kid>:base64(iv[12] | authTag[16] | ciphertext)`, con AAD
 * `nexo:v2:<kid>:<contexto canónico>`: el `kid` permite convivir con varias claves y rotar, y el contexto
 * (`CipherContext`: workspace, tipo/campo e identificadores inmutables) impide mover un valor cifrado a otra fila.
 *
 * Formato legacy (antes de B7): `base64(iv | authTag | ciphertext)` con `ENCRYPTION_KEY` y sin AAD. Se sigue leyendo
 * (salvo `ENCRYPTION_LEGACY_READS=false`); toda escritura nueva usa v2 con la clave activa y `npm run crypto:rotate`
 * re-cifra lo existente.
 */
@Injectable()
export class CryptoService {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKid: string;
  private readonly legacyKid: string | null;
  private readonly legacyReads: boolean;

  constructor(config: ConfigService) {
    const keyring = CryptoService.keyringFrom(config);
    for (const [kid, hex] of Object.entries(keyring.keys)) this.keys.set(kid, Buffer.from(hex, 'hex'));
    this.activeKid = keyring.activeKid;
    this.legacyKid = keyring.legacyKid;
    this.legacyReads = keyring.legacyReads;
  }

  /** `encryption` (anillo ya validado) o, en pruebas y herramientas, solo `encryptionKey` (clave legacy `k0`). */
  private static keyringFrom(config: ConfigService): EncryptionKeyring {
    const ring = config.get<EncryptionKeyring>('encryption');
    if (ring?.keys && ring.activeKid) return ring;
    const { keyring, errors } = parseKeyring({ ENCRYPTION_KEY: config.get<string>('encryptionKey') ?? '' });
    if (!keyring) throw new Error(`Configuración de cifrado inválida: ${errors.join('; ')}`);
    return keyring;
  }

  /** `kid` con el que se cifra todo lo nuevo. */
  get currentKid(): string {
    return this.activeKid;
  }

  encrypt(plain: string, context: CipherContext): string {
    const key = this.keys.get(this.activeKid)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.aad(this.activeKid, context));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${V2}:${this.activeKid}:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
  }

  /**
   * Descifra un valor v2 (exige el mismo contexto con el que se cifró) o legacy (sin AAD: el contexto se ignora).
   * Lanza `DecryptionError` si la clave no está configurada, el contexto no coincide o el valor fue alterado.
   */
  decrypt(payload: string, context: CipherContext): string {
    const parsed = this.parse(payload);
    const decipher = createDecipheriv('aes-256-gcm', parsed.key, parsed.raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(parsed.raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    if (parsed.kid) decipher.setAAD(this.aad(parsed.kid, context));
    try {
      return Buffer.concat([decipher.update(parsed.raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new DecryptionError(parsed.kid ? 'clave o contexto incorrectos, o datos alterados' : 'datos alterados');
    }
  }

  /** `true` si el valor está en formato legacy o cifrado con una clave distinta de la activa. */
  needsRotation(payload: string): boolean {
    return !payload.startsWith(`${V2}:${this.activeKid}:`);
  }

  /** El mismo valor si ya usa la clave activa; si no, lo descifra y lo vuelve a cifrar (v2, clave activa). */
  reencrypt(payload: string, context: CipherContext): string {
    return this.needsRotation(payload) ? this.encrypt(this.decrypt(payload, context), context) : payload;
  }

  /** `kid` de un valor cifrado (`k0` para el formato legacy). Útil para informes de rotación. */
  static kidOf(payload: string): string {
    if (!payload.startsWith(`${V2}:`)) return LEGACY_KID;
    return payload.slice(V2.length + 1, payload.indexOf(':', V2.length + 1));
  }

  private aad(kid: string, context: CipherContext): Buffer {
    return Buffer.from(`nexo:${V2}:${kid}:${serializeContext(context)}`, 'utf8');
  }

  private parse(payload: string): { kid: string | null; key: Buffer; raw: Buffer } {
    if (typeof payload !== 'string' || !payload) throw new DecryptionError('valor vacío');
    let kid: string | null = null;
    let body = payload;
    if (payload.startsWith(`${V2}:`)) {
      const sep = payload.indexOf(':', V2.length + 1);
      if (sep < 0) throw new DecryptionError('formato inválido');
      kid = payload.slice(V2.length + 1, sep);
      body = payload.slice(sep + 1);
    } else if (payload.includes(':')) {
      throw new DecryptionError('versión de formato desconocida');
    }
    const keyId = kid ?? (this.legacyReads ? this.legacyKid : null);
    const key = keyId ? this.keys.get(keyId) : undefined;
    if (!key) {
      throw new DecryptionError(
        kid
          ? `la clave ${kid} no está configurada`
          : 'formato legacy sin ENCRYPTION_KEY o con lecturas legacy desactivadas',
      );
    }
    const raw = Buffer.from(body, 'base64');
    if (raw.length < IV_BYTES + TAG_BYTES) throw new DecryptionError('valor truncado');
    return { kid, key, raw };
  }

  static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  static randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}

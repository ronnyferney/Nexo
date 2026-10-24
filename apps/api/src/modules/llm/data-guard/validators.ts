/**
 * Validaciones de dígito de control de los identificadores que reconoce DataGuard (ADR 0008 D1). Funciones puras sobre
 * la forma compacta (sin separadores). Reducen los falsos positivos: un número que no valida no se enmascara.
 */

export const digitsOf = (s: string) => s.replace(/\D/g, '');
export const compact = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** Algoritmo de Luhn (tarjetas de pago). */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Prefijos de emisores (IIN) de las redes habituales: Visa, Mastercard, Amex, Diners, Discover, JCB, UnionPay. */
export function plausibleCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  const p2 = Number(digits.slice(0, 2));
  const p3 = Number(digits.slice(0, 3));
  const p4 = Number(digits.slice(0, 4));
  if (digits[0] === '4') return [13, 16, 19].includes(digits.length);
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return digits.length === 16;
  if (p2 === 34 || p2 === 37) return digits.length === 15;
  if (p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) return digits.length >= 14 && digits.length <= 19;
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return digits.length >= 16;
  if (p2 === 35) return digits.length >= 16;
  if (p2 === 62) return digits.length >= 16;
  return false;
}

export function validCard(raw: string): boolean {
  const d = digitsOf(raw);
  return plausibleCard(d) && luhn(d);
}

/** Longitud del IBAN por país (registro SWIFT) para los países más frecuentes; otros se validan solo con mod 97. */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, ES: 24,
  FI: 18, FR: 27, GB: 22, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IT: 27, LT: 20, LU: 20, LV: 21, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SV: 28,
}; // prettier-ignore

export function ibanLength(country: string): number | undefined {
  return IBAN_LENGTHS[country];
}

/** Dígitos de control ISO 13616 (mod 97 = 1). */
export function validIban(raw: string): boolean {
  const iban = compact(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** DNI español: 8 dígitos + letra de control. */
export function validDniEs(raw: string): boolean {
  const v = compact(raw);
  if (!/^\d{8}[A-Z]$/.test(v)) return false;
  return DNI_LETTERS[Number(v.slice(0, 8)) % 23] === v[8];
}

/** NIE español: X/Y/Z + 7 dígitos + letra de control. */
export function validNie(raw: string): boolean {
  const v = compact(raw);
  if (!/^[XYZ]\d{7}[A-Z]$/.test(v)) return false;
  const n = Number(String('XYZ'.indexOf(v[0])) + v.slice(1, 8));
  return DNI_LETTERS[n % 23] === v[8];
}

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** NIT colombiano con dígito de verificación (DIAN, módulo 11 con pesos primos). */
export function validNit(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length < 9 || d.length > 16) return false;
  const body = d.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * NIT_WEIGHTS[i];
  const r = sum % 11;
  const dv = r > 1 ? 11 - r : r;
  return dv === Number(d[d.length - 1]);
}

/** CPF brasileño (dos dígitos de control). */
export function validCpf(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return (r === 10 ? 0 : r) === Number(d[len]);
  };
  return check(9) && check(10);
}

/** RUT/RUN chileno (módulo 11, dígito verificador 0-9 o K). */
export function validRut(raw: string): boolean {
  const v = compact(raw);
  if (!/^\d{7,8}[0-9K]$/.test(v)) return false;
  const body = v.slice(0, -1);
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (sum % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return dv === v[v.length - 1];
}

/** Fecha AAMMDD plausible (CURP y RFC mexicanos). */
export function validYymmdd(s: string): boolean {
  if (!/^\d{6}$/.test(s)) return false;
  const m = Number(s.slice(2, 4));
  const d = Number(s.slice(4, 6));
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

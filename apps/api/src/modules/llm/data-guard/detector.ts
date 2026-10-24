import {
  compact,
  digitsOf,
  ibanLength,
  validCard,
  validCpf,
  validDniEs,
  validIban,
  validNie,
  validNit,
  validRut,
  validYymmdd,
} from './validators';

/**
 * DataGuard — detector de datos sensibles (ADR 0008 D1). Módulo puro y determinista: sin IA, sin red y sin estado.
 * Devuelve hallazgos `{ category, kind, start, end, confidence }` con las posiciones en el texto, nunca el valor.
 *
 * Expresiones lineales y acotadas (sin cuantificadores anidados ambiguos sin límite) para no exponer la API a ReDoS
 * con entradas grandes (resultados de herramientas de hasta 50 000 caracteres).
 */
export type DataCategory = 'EMAIL' | 'PHONE' | 'PAYMENT_CARD' | 'NATIONAL_ID' | 'BANK_ACCOUNT' | 'CREDENTIAL';

export const DATA_CATEGORIES: DataCategory[] = [
  'NATIONAL_ID',
  'PAYMENT_CARD',
  'BANK_ACCOUNT',
  'EMAIL',
  'PHONE',
  'CREDENTIAL',
];

/** Nombre visible de cada categoría (mensajes y avisos en español). */
export const CATEGORY_LABELS: Record<DataCategory, string> = {
  NATIONAL_ID: 'documento de identidad',
  PAYMENT_CARD: 'tarjeta de pago',
  BANK_ACCOUNT: 'cuenta bancaria',
  EMAIL: 'correo electrónico',
  PHONE: 'teléfono',
  CREDENTIAL: 'credencial',
};

export interface Finding {
  category: DataCategory;
  /** Subtipo: `ES_DNI`, `CO_NIT`, `IBAN`, `JWT`, `VAULT`… */
  kind: string;
  start: number;
  end: number;
  confidence: number;
}

export interface DetectOptions {
  /**
   * Valores en claro de la bóveda del workspace: toda aparición literal (y su forma base64) es una `CREDENTIAL`. Los
   * valores de menos de `MIN_SECRET_LENGTH` caracteres se ignoran (producirían falsos positivos en texto normal).
   */
  secrets?: string[];
}

export const MIN_SECRET_LENGTH = 6;

interface Rule {
  category: DataCategory;
  kind: string;
  re: RegExp;
  /** Grupo de captura con el valor (por defecto, la coincidencia completa). */
  group?: number;
  validate?: (value: string, match: RegExpExecArray) => boolean;
  confidence: number;
}

/** Prioridad al resolver solapamientos: gana la categoría más sensible y, a igualdad, el hallazgo más largo. */
const PRIORITY: Record<DataCategory, number> = {
  CREDENTIAL: 6,
  PAYMENT_CARD: 5,
  BANK_ACCOUNT: 4,
  NATIONAL_ID: 3,
  EMAIL: 2,
  PHONE: 1,
};

const hasDigitOrSymbol = (v: string) => /[0-9!@#$%^&*()_+=[\]{}|\\:<>?/~`.-]/.test(v);
/** Palabras clave que por sí solas nombran una contraseña (no "clave" o "token", demasiado genéricas en español). */
const STRONG_PASSWORD_KEY = /^(?:password|passwd|pwd|contrase(?:ñ|n)a|client[_-]?secret|secret)/i;

const ID_WORDS =
  'c[ée]dula(?:\\s+de\\s+(?:ciudadan[íi]a|extranjer[íi]a|identidad))?|documento(?:\\s+de\\s+identidad)?|' +
  'n[uú]mero\\s+de\\s+(?:identificaci[óo]n|documento)|identificaci[óo]n|pasaporte|passport';
const ID_ABBREVIATIONS =
  'C\\.\\s?C\\.?|CC|C\\.\\s?E\\.?|CE|T\\.\\s?I\\.?|TI|DNI|NUIP|NIT|RUT|RUN|RUC|CPF|CUIL|CUIT|CI|NIE';
const ID_VALUE = '\\s*(?:(?:es|n[oº°.]{1,2}|n[uú]mero|#)\\s*)?[:#]?\\s*([A-Z]{0,3}\\d[\\d.\\-]{3,16}[\\dkK])(?![\\d])';

const RULES: Rule[] = [
  // ---------------------------------------------------------------- CREDENTIAL (siempre se bloquea, ADR 0008 D2)
  {
    category: 'CREDENTIAL',
    kind: 'PRIVATE_KEY',
    re: /-----BEGIN (?:[A-Z0-9]{1,20} ){0,4}PRIVATE KEY-----(?:[\s\S]{0,16384}?-----END (?:[A-Z0-9]{1,20} ){0,4}PRIVATE KEY-----|[A-Za-z0-9+/=\s]{0,16384})/g,
    confidence: 1,
  },
  {
    category: 'CREDENTIAL',
    kind: 'JWT',
    re: /(?<![\w-])eyJ[A-Za-z0-9_-]{5,4096}\.eyJ[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{10,4096}/g,
    confidence: 0.99,
  },
  {
    category: 'CREDENTIAL',
    kind: 'API_KEY',
    re: /(?<![\w-])(?:sk-ant-[a-z]{2,8}\d{0,3}-[A-Za-z0-9_-]{20,300}|sk-(?:proj-|svcacct-|or-v1-)?[A-Za-z0-9_-]{20,300}|(?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{22,255}|xox[abposr]-[A-Za-z0-9-]{10,255}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,255}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}|SG\.[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{16,128}|hf_[A-Za-z0-9]{30,255}|nexo_[A-Za-z0-9_-]{24,255})/g,
    confidence: 0.98,
  },
  {
    category: 'CREDENTIAL',
    kind: 'BEARER',
    re: /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+/-]{16,4096}=*)/g,
    group: 1,
    confidence: 0.95,
  },
  {
    category: 'CREDENTIAL',
    kind: 'CONNECTION_STRING',
    re: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:/@"'<>]{1,64}:([^\s@/"'<>]{1,128})@/gi,
    group: 1,
    confidence: 0.97,
  },
  {
    category: 'CREDENTIAL',
    kind: 'PASSWORD',
    re: /(?<![A-Za-z])(password|passwd|pwd|contrase(?:ñ|n)a|clave\s+de\s+acceso|clave|api[_-]?key|apikey|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|token)["']?\s{0,3}(?:[:=]|=>|\bes\b)\s{0,3}["']?([^\s"',;<>]{3,199}[^\s"',;<>.])/gi,
    group: 2,
    // "clave"/"token" son palabras comunes: solo cuenta si el valor parece secreto (dígitos o símbolos).
    validate: (value, m) => STRONG_PASSWORD_KEY.test(m[1]) || hasDigitOrSymbol(value),
    confidence: 0.85,
  },

  // ---------------------------------------------------------------- PAYMENT_CARD (Luhn + prefijo de emisor)
  {
    category: 'PAYMENT_CARD',
    kind: 'CARD',
    re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
    validate: validCard,
    confidence: 0.95,
  },

  // ---------------------------------------------------------------- BANK_ACCOUNT
  {
    category: 'BANK_ACCOUNT',
    kind: 'IBAN',
    re: /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}/g,
    // El candidato puede arrastrar la palabra siguiente: se recorta a la longitud del país antes de validar.
    validate: validIban,
    confidence: 0.99,
  },
  {
    category: 'BANK_ACCOUNT',
    kind: 'ACCOUNT',
    re: /(?<![A-Za-z])(?:n[uú]mero\s+de\s+cuenta|cuenta|cta\.?|account|acct\.?)(?:\s{1,3}(?:de\s+)?(?:ahorros?|corriente|bancaria|n[oº°.]{1,2}|n[uú]mero|#)){0,3}\s{0,3}[:#]?\s{0,3}(\d(?:[ -]?\d){7,21})(?!\d)/gi,
    group: 1,
    confidence: 0.8,
  },

  // ---------------------------------------------------------------- NATIONAL_ID
  {
    category: 'NATIONAL_ID',
    kind: 'ES_DNI',
    re: /(?<![\w-])\d{8}[ -]?[A-Za-z](?!\w)/g,
    validate: validDniEs,
    confidence: 0.95,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'ES_NIE',
    re: /(?<![\w-])[XYZxyz][ -]?\d{7}[ -]?[A-Za-z](?!\w)/g,
    validate: validNie,
    confidence: 0.95,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'CO_NIT',
    re: /(?<![\d.])\d{3}\.?\d{3}\.?\d{3} ?- ?\d(?![\d])/g,
    validate: validNit,
    confidence: 0.9,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'BR_CPF',
    re: /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])/g,
    validate: validCpf,
    confidence: 0.95,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'CL_RUT',
    re: /(?<![\d.])\d{1,2}\.?\d{3}\.?\d{3}-[\dkK](?![\w])/g,
    validate: validRut,
    confidence: 0.9,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'MX_CURP',
    re: /(?<![A-Z0-9])[A-Z][AEIOUX][A-Z]{2}(\d{6})[HMX](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d(?![A-Z0-9])/g,
    validate: (_v, m) => validYymmdd(m[1]),
    confidence: 0.97,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'MX_RFC',
    re: /(?<![A-Z0-9Ñ&])[A-ZÑ&]{4}(\d{6})[A-Z\d]{3}(?![A-Z0-9])/g,
    validate: (_v, m) => validYymmdd(m[1]),
    confidence: 0.85,
  },
  // Documentos sin dígito de control (cédula colombiana, DNI de Perú/Argentina, CI, pasaporte…): solo con contexto.
  {
    category: 'NATIONAL_ID',
    kind: 'ID_CONTEXT',
    re: new RegExp(`(?<![A-Za-zÀ-ÿ])(?:${ID_WORDS})${ID_VALUE}`, 'gi'),
    group: 1,
    validate: (v) => {
      const d = digitsOf(v);
      return d.length >= 5 && d.length <= 13;
    },
    confidence: 0.9,
  },
  {
    category: 'NATIONAL_ID',
    kind: 'ID_CONTEXT',
    re: new RegExp(`(?<![A-Za-z])(?:${ID_ABBREVIATIONS})(?![A-Za-z])${ID_VALUE}`, 'g'),
    group: 1,
    validate: (v) => {
      const d = digitsOf(v);
      return d.length >= 5 && d.length <= 13;
    },
    confidence: 0.85,
  },

  // ---------------------------------------------------------------- EMAIL
  {
    category: 'EMAIL',
    kind: 'EMAIL',
    re: /(?<![\w.%+-])[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}\.){1,8}[A-Za-z]{2,24}(?![\w-])/g,
    confidence: 0.99,
  },

  // ---------------------------------------------------------------- PHONE
  {
    category: 'PHONE',
    kind: 'INTERNATIONAL',
    re: /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){1,5}(?![\d])/g,
    validate: (v) => {
      const d = digitsOf(v);
      return d.length >= 8 && d.length <= 15;
    },
    confidence: 0.9,
  },
  {
    category: 'PHONE',
    kind: 'CO_MOBILE',
    re: /(?<![\d.,-])3\d{2}[ .-]?\d{3}[ .-]?\d{4}(?![\d.,-]?\d)/g,
    confidence: 0.75,
  },
  {
    category: 'PHONE',
    kind: 'CO_LANDLINE',
    re: /(?<![\d.,-])60[1-8][ .-]?\d{3}[ .-]?\d{4}(?![\d.,-]?\d)/g,
    confidence: 0.75,
  },
  {
    category: 'PHONE',
    kind: 'ES_PHONE',
    re: /(?<![\d.,-])[6-9]\d{2}(?: \d{2} \d{2} \d{2}| \d{3} \d{3})(?![\d.,-]?\d)/g,
    confidence: 0.7,
  },
  {
    category: 'PHONE',
    kind: 'PHONE_CONTEXT',
    re: /(?<![A-Za-z])(?:tel[ée]fono|tel\.|tlf\.?|celular|cel\.|m[óo]vil|whats[aA]pp|phone|fijo)\s{0,3}(?:n[oº°.]{1,2}\s{0,3})?[:#]?\s{0,3}(\+?\(?\d(?:[ ().-]{0,2}\d){6,14})(?!\d)/gi,
    group: 1,
    confidence: 0.85,
  },
];

/** Recorta un candidato IBAN a la longitud oficial del país (el regex puede incluir la palabra siguiente). */
function ibanSpan(text: string, start: number, end: number): number | null {
  const country = text.slice(start, start + 2);
  const want = ibanLength(country);
  if (want === undefined) return validIban(text.slice(start, end)) ? end : null;
  let count = 0;
  for (let i = start; i < end; i++) {
    if (text[i] !== ' ') count++;
    if (count === want) {
      const next = text[i + 1];
      if (next !== undefined && /[A-Za-z0-9]/.test(next)) return null;
      return validIban(text.slice(start, i + 1)) ? i + 1 : null;
    }
  }
  return null;
}

function* ruleFindings(text: string, rule: Rule): Generator<Finding> {
  rule.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rule.re.exec(text)) !== null) {
    if (m[0].length === 0) {
      rule.re.lastIndex++;
      continue;
    }
    const value = rule.group ? m[rule.group] : m[0];
    if (value === undefined) continue;
    const offset = rule.group ? m[0].lastIndexOf(value) : 0;
    const start = m.index + offset;
    let end = start + value.length;
    if (rule.kind === 'IBAN') {
      const cut = ibanSpan(text, start, end);
      if (cut === null) continue;
      end = cut;
    } else if (rule.validate && !rule.validate(value, m)) {
      continue;
    }
    yield {
      category: rule.category,
      kind: rule.kind,
      start,
      end: trimEnd(text, start, end),
      confidence: rule.confidence,
    };
  }
}

/** Sin separadores sueltos al final del hallazgo (`"300 123 4567 "`). */
function trimEnd(text: string, start: number, end: number): number {
  while (end > start && /[\s.-]/.test(text[end - 1])) end--;
  return end;
}

function* secretFindings(text: string, secrets: string[]): Generator<Finding> {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (typeof s !== 'string' || s.length < MIN_SECRET_LENGTH) continue;
    needles.add(s);
    needles.add(Buffer.from(s, 'utf8').toString('base64'));
    needles.add(Buffer.from(s, 'utf8').toString('base64url'));
  }
  for (const needle of needles) {
    let from = 0;
    for (let i = text.indexOf(needle, from); i !== -1; i = text.indexOf(needle, from)) {
      yield { category: 'CREDENTIAL', kind: 'VAULT', start: i, end: i + needle.length, confidence: 1 };
      from = i + needle.length;
    }
  }
}

/**
 * Hallazgos sin solapamientos, ordenados por posición. Ante solapamientos gana la categoría más sensible
 * (credencial > tarjeta > cuenta > documento > correo > teléfono) y, a igualdad, el hallazgo más largo.
 */
export function detect(text: string, opts: DetectOptions = {}): Finding[] {
  if (!text) return [];
  const all: Finding[] = [...secretFindings(text, opts.secrets ?? [])];
  for (const rule of RULES) for (const f of ruleFindings(text, rule)) if (f.end > f.start) all.push(f);
  all.sort(
    (a, b) =>
      PRIORITY[b.category] - PRIORITY[a.category] ||
      b.confidence - a.confidence ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const accepted: Finding[] = [];
  for (const f of all) {
    if (!accepted.some((x) => f.start < x.end && x.start < f.end)) accepted.push(f);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** Forma canónica de un valor para asignarle siempre el mismo marcador (correo en minúsculas, resto compacto). */
export function normalizeValue(category: DataCategory, value: string): string {
  return category === 'EMAIL' ? value.trim().toLowerCase() : compact(value);
}

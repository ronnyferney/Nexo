import type { CanalCuentaEstado, CanalTipo, EstadoMensajeCanal } from '../../core/channels.models';

/** Clase de `.badge` del design system (vacía = neutra). */
export type BadgeClase = '' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

export interface Meta {
  label: string;
  badge: BadgeClase;
}

export interface TipoMeta extends Meta {
  /** Ícono del mapa de `nx-icon`. */
  icon: string;
}

// ============================ Tipo de canal ============================

export const TIPO_CANAL_META: Record<CanalTipo, TipoMeta> = {
  CORREO: { label: 'Correo', badge: 'info', icon: 'send' },
  WHATSAPP: { label: 'WhatsApp', badge: 'success', icon: 'inbox' },
  VOZ: { label: 'Voz', badge: 'primary', icon: 'headset' },
};

export const tipoCanalMeta = (t: CanalTipo): TipoMeta => TIPO_CANAL_META[t];

/** Placeholder del destino según el tipo de canal (ayuda al usuario a ingresar un valor válido). */
export function destinoPlaceholder(t: CanalTipo): string {
  switch (t) {
    case 'CORREO':
      return 'destinatario@empresa.com';
    case 'WHATSAPP':
      return '+57 300 000 0000';
    case 'VOZ':
      return '+57 1 000 0000';
  }
}

// ============================ Estado de la cuenta ============================

export const ESTADO_CUENTA_META: Record<CanalCuentaEstado, Meta> = {
  ACTIVA: { label: 'Activa', badge: 'success' },
  SUSPENDIDA: { label: 'Suspendida', badge: 'warning' },
  RETIRADA: { label: 'Retirada', badge: 'danger' },
};

export const estadoCuentaMeta = (e: CanalCuentaEstado): Meta => ESTADO_CUENTA_META[e];

// ============================ Estado del mensaje ============================

/**
 * Color por estado del envío. SIMULADO = sandbox (info), FALLIDO = rojo, PENDIENTE = en espera (aprobación E6 o
 * despacho), ENVIADO = aceptado por el proveedor, ENTREGADO = confirmado.
 */
export const ESTADO_MENSAJE_META: Record<EstadoMensajeCanal, Meta> = {
  SIMULADO: { label: 'Simulado', badge: 'info' },
  PENDIENTE: { label: 'Pendiente', badge: 'warning' },
  ENVIADO: { label: 'Enviado', badge: 'primary' },
  ENTREGADO: { label: 'Entregado', badge: 'success' },
  FALLIDO: { label: 'Fallido', badge: 'danger' },
};

export const estadoMensajeMeta = (e: EstadoMensajeCanal): Meta => ESTADO_MENSAJE_META[e];

/** Un envío SIMULADO no salió a la red (proveedor `simulado`, sandbox). */
export const esSimulado = (e: EstadoMensajeCanal): boolean => e === 'SIMULADO';

/** El proveedor `simulado` no sale a la red: todo queda en sandbox. */
export const esProveedorSimulado = (proveedor: string): boolean => proveedor.trim().toLowerCase() === 'simulado';

// ============================ Validación de secretRef ============================

/**
 * Patrón de NOMBRE de secreto de bóveda (espejo de `SECRET_NAME_PATTERN` del backend): MAYÚSCULAS, dígitos y guiones
 * bajos, iniciando con letra, entre 2 y 64 caracteres. Aquí viaja el NOMBRE de la clave, jamás el valor del secreto.
 */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** `true` si el texto tiene forma de nombre de clave de bóveda válido. */
export function esNombreSecretoValido(nombre: string): boolean {
  return SECRET_NAME_PATTERN.test(nombre.trim());
}

/**
 * Heurística anti-fuga: delata un texto que parece el VALOR de un secreto (no un nombre). Lo señalamos para evitar
 * que alguien pegue la credencial en claro donde solo va el nombre de la clave de bóveda.
 */
export function pareceValorDeSecreto(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  // Minúsculas, espacios o símbolos ajenos a un nombre de clave sugieren un valor real pegado por error.
  return /[a-z]/.test(t) || /\s/.test(t) || /[^A-Z0-9_]/.test(t);
}

/** Mensaje de ayuda/validación del campo `secretRef` según lo escrito (o `null` si es válido o vacío). */
export function mensajeSecretRef(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  if (esNombreSecretoValido(t)) return null;
  if (pareceValorDeSecreto(t)) {
    return 'Escriba solo el NOMBRE de la clave de bóveda (ej. M365_CLIENT_SECRET), nunca el valor del secreto.';
  }
  return 'Nombre de secreto en MAYUSCULAS_CON_GUIONES (ej. M365_CLIENT_SECRET).';
}

// ============================ Clave de idempotencia ============================

/**
 * Genera una clave de idempotencia nueva para un envío. Un reintento con la MISMA clave no duplica el mensaje
 * (el backend devuelve el existente). Usa `crypto.randomUUID` cuando está disponible, con respaldo determinista.
 */
export function nuevaIdempotencyKey(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `canal-${uuid}`;
}

// ============================ Agrupación por empresa ============================

export interface GrupoEmpresa<T extends { empresaId: string }> {
  empresaId: string;
  items: T[];
}

/** Agrupa las cuentas por empresa, conservando el orden de aparición (el backend ya ordena por `updatedAt desc`). */
export function agruparPorEmpresa<T extends { empresaId: string }>(cuentas: readonly T[]): GrupoEmpresa<T>[] {
  const grupos = new Map<string, T[]>();
  for (const c of cuentas) {
    const lista = grupos.get(c.empresaId);
    if (lista) lista.push(c);
    else grupos.set(c.empresaId, [c]);
  }
  return [...grupos].map(([empresaId, items]) => ({ empresaId, items }));
}

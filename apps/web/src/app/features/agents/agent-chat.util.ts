/** Utilidades puras del panel de prueba del agente (clasificación de eventos y nombres legibles). */

/** Un aviso del backend es de seguridad (DataGuard) si empieza con este prefijo; el resto son informativos. */
export const SECURITY_NOTICE_PREFIX = 'Protección de datos';

/** Forma mínima de un elemento del chat para clasificarlo (compatible con ChatItem). */
export interface ClassifiableItem {
  kind: string;
  text?: string;
}

/** ¿El aviso corresponde a una política de protección de datos (para agruparlo fuera de la conversación)? */
export const isSecurityNotice = (i: ClassifiableItem): boolean =>
  i.kind === 'notice' && !!i.text?.startsWith(SECURITY_NOTICE_PREFIX);

/**
 * Replica el identificador de herramienta del backend (`toolName` en agent-runtime): `<conector>__<operación>`,
 * ambos en minúsculas y saneados, el conector acotado a 24 caracteres y el total a 64. Sirve para mapear el nombre
 * técnico que llega por el stream al nombre legible del conector y la operación.
 */
export function toolSlug(connectorName: string, opKey: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  return `${slug(connectorName).slice(0, 24)}__${slug(opKey)}`.slice(0, 64);
}

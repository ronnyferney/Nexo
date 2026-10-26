import type { NivelRiesgo } from '@prisma/client';

/**
 * Catálogo BASE de referencia (punto 7 de las decisiones del patrocinador · E6+). Política conservadora de arranque,
 * sembrada como "de sistema" por workspace (empresaId = null). SIN umbrales monetarios: los define Finanzas, por eso
 * `umbralMonto`/`moneda`/`limiteAcumuladoPeriodo` nacen NULOS (no se inventan montos). El `codigo` de estas entradas no
 * se edita; sus banderas, nivel de riesgo y (más adelante) umbrales sí son configurables por empresa.
 */
export interface DefinicionAccionSensible {
  codigo: string;
  nombre: string;
  requiereAprobacion: boolean;
  requiereDobleAprobacion: boolean;
  nivelRiesgoPorDefecto: NivelRiesgo;
}

export const CATALOGO_BASE_ACCIONES_SENSIBLES: ReadonlyArray<DefinicionAccionSensible> = [
  // Pagos/transferencias y cambio de cuentas bancarias → doble aprobación, riesgo ALTO.
  {
    codigo: 'PAGO',
    nombre: 'Pago o transferencia de fondos',
    requiereAprobacion: true,
    requiereDobleAprobacion: true,
    nivelRiesgoPorDefecto: 'ALTO',
  },
  {
    codigo: 'CAMBIO_CUENTA_BANCARIA',
    nombre: 'Cambio de cuenta bancaria de un beneficiario',
    requiereAprobacion: true,
    requiereDobleAprobacion: true,
    nivelRiesgoPorDefecto: 'ALTO',
  },
  // Elevación de privilegios y borrado crítico → doble aprobación, riesgo ALTO.
  {
    codigo: 'ELEVACION_PRIVILEGIO',
    nombre: 'Elevación de privilegios de acceso',
    requiereAprobacion: true,
    requiereDobleAprobacion: true,
    nivelRiesgoPorDefecto: 'ALTO',
  },
  {
    codigo: 'BORRADO_CRITICO',
    nombre: 'Borrado de datos o recursos críticos',
    requiereAprobacion: true,
    requiereDobleAprobacion: true,
    nivelRiesgoPorDefecto: 'ALTO',
  },
  // Publicación oficial → aprobación humana (la doble aprobación la fija la política si corresponde).
  {
    codigo: 'PUBLICACION_OFICIAL',
    nombre: 'Publicación oficial externa',
    requiereAprobacion: true,
    requiereDobleAprobacion: false,
    nivelRiesgoPorDefecto: 'ALTO',
  },
  // Comunicación rutinaria → sin aprobación, riesgo BAJO.
  {
    codigo: 'EMAIL_SEND',
    nombre: 'Envío de correo electrónico',
    requiereAprobacion: false,
    requiereDobleAprobacion: false,
    nivelRiesgoPorDefecto: 'BAJO',
  },
  {
    codigo: 'WHATSAPP_SEND',
    nombre: 'Envío de mensaje de WhatsApp',
    requiereAprobacion: false,
    requiereDobleAprobacion: false,
    nivelRiesgoPorDefecto: 'BAJO',
  },
  {
    codigo: 'VOICE_CALL',
    nombre: 'Llamada de voz saliente',
    requiereAprobacion: false,
    requiereDobleAprobacion: false,
    nivelRiesgoPorDefecto: 'BAJO',
  },
];

/** Códigos de sistema (para validar que no se cree/edite su `codigo` como si fuera un código libre). */
export const CODIGOS_BASE_SISTEMA: ReadonlySet<string> = new Set(CATALOGO_BASE_ACCIONES_SENSIBLES.map((d) => d.codigo));

import type { BadgeClase, Meta } from '../canales/canales.util';
import type { EstadoLlamadaVoz, VozModoDialogo } from '../../core/voice.models';

/**
 * Lógica PURA de la sección de Voz (E14 · ADR 0015 D2), sandbox SIN gasto, sin dependencias de Angular. Reúne:
 * el color/etiqueta por estado de llamada, el catálogo de proveedores de voz con sus capabilities por capa y los
 * requisitos de activación (espejo de los adaptadores del backend), y el cálculo del estado de activación de una cuenta
 * (INACTIVO sin credenciales / gated). Se prueba con `voz.util.spec.ts`. El contrato `/voz` NO expone las capabilities,
 * de modo que este catálogo las refleja para informar al usuario; el backend sigue siendo la fuente de verdad al operar.
 */

// ============================ Estado de la llamada ============================

/**
 * Color por estado de la llamada. SIMULADA = sandbox (info, sin red); INICIADA/EN_CURSO avanzan; TRANSFERIDA a humano;
 * FINALIZADA cerrada; FALLIDA = stub inactivo o error de negocio.
 */
export const ESTADO_LLAMADA_META: Record<EstadoLlamadaVoz, Meta> = {
  INICIADA: { label: 'Iniciada', badge: 'primary' },
  EN_CURSO: { label: 'En curso', badge: 'primary' },
  TRANSFERIDA: { label: 'Transferida', badge: 'warning' },
  FINALIZADA: { label: 'Finalizada', badge: 'success' },
  FALLIDA: { label: 'Fallida', badge: 'danger' },
  SIMULADA: { label: 'Simulada', badge: 'info' },
};

export const estadoLlamadaMeta = (e: EstadoLlamadaVoz): Meta => ESTADO_LLAMADA_META[e];

/** Una llamada ya terminada (FINALIZADA/FALLIDA) no admite más turnos, transferencias ni cierre. */
export const llamadaTerminada = (e: EstadoLlamadaVoz): boolean => e === 'FINALIZADA' || e === 'FALLIDA';

/** Una llamada activa (admite operaciones): iniciada, en curso, simulada o transferida. */
export const llamadaActiva = (e: EstadoLlamadaVoz): boolean => !llamadaTerminada(e);

// ============================ Capas y capabilities ============================

/** Las 4 capas del contrato de voz (ADR 0015 D2). */
export const VOZ_CAPAS = ['TELEFONIA', 'VOZ', 'DIALOGO', 'PROCESOS'] as const;
export type VozCapa = (typeof VOZ_CAPAS)[number];

/** Etiqueta legible de cada capa. */
export const CAPA_LABEL: Record<VozCapa, string> = {
  TELEFONIA: 'Telefonía',
  VOZ: 'STT / TTS',
  DIALOGO: 'Motor conversacional',
  PROCESOS: 'Procesos y autorizaciones',
};

export const capaLabel = (c: VozCapa): string => CAPA_LABEL[c];

/** Capabilities declaradas por capa (espejo de `VoiceCapabilities` del backend). */
export interface VozCapabilities {
  telefonia: readonly string[];
  voz: readonly string[];
  dialogo: readonly string[];
  procesos: readonly string[];
}

/** Recursos y tarifas pendientes de cotizar para activar una capa en producción (insumo de presupuesto, no precios). */
export interface VozRequisitoCapa {
  capa: VozCapa;
  recursos: string;
  faltaCotizar: string;
}

/** Entrada del catálogo de proveedores de voz. */
export interface VozProveedorInfo {
  /** Clave canónica del proveedor (minúsculas). */
  proveedor: string;
  /** Alias por los que también se selecciona (p. ej. `connect`, `gcp`). */
  alias: readonly string[];
  /** Nombre legible para la UI. */
  legible: string;
  /** `true` si el adaptador opera sin credenciales ni red (solo `simulado`). */
  sandbox: boolean;
  /** `true` si la activación productiva está gated (stubs), aun con credenciales. */
  gated: boolean;
  capabilities: VozCapabilities;
  requisitosActivacion: readonly VozRequisitoCapa[];
}

const ACTION_GATEWAY_REQ: VozRequisitoCapa = {
  capa: 'PROCESOS',
  recursos: 'ActionGateway de E6 (ya existente); las acciones sensibles permanecen en NEXO, el proveedor no ejecuta negocio.',
  faltaCotizar: 'Nada por este concepto (gobierno propio de NEXO).',
};

/**
 * Catálogo de proveedores de voz (espejo de los adaptadores del backend: `simulado`, `amazon_connect`, `google_cloud`).
 * Las capabilities por capa y los requisitos de activación se reproducen para informar al usuario en configuración.
 */
export const VOZ_PROVEEDORES: readonly VozProveedorInfo[] = [
  {
    proveedor: 'simulado',
    alias: [],
    legible: 'Simulado (sandbox)',
    sandbox: true,
    gated: false,
    capabilities: {
      telefonia: ['inbound', 'outbound', 'transfer', 'dtmf', 'numberProvisioning'],
      voz: ['streamingStt', 'tts', 'bargeIn', 'wordTimestamps'],
      dialogo: ['externalDialog', 'humanHandoff'],
      procesos: ['actionGateway'],
    },
    requisitosActivacion: [
      { capa: 'TELEFONIA', recursos: 'Ninguno: el simulador no aprovisiona números ni cursa llamadas reales.', faltaCotizar: 'Nada (sin gasto).' },
      { capa: 'VOZ', recursos: 'Ninguno: STT/TTS simulados en memoria.', faltaCotizar: 'Nada (sin gasto).' },
      { capa: 'DIALOGO', recursos: 'Runtime de agentes de NEXO (ya existente).', faltaCotizar: 'Nada (sin gasto).' },
      { capa: 'PROCESOS', recursos: 'ActionGateway de E6 (ya existente).', faltaCotizar: 'Nada (sin gasto).' },
    ],
  },
  {
    proveedor: 'amazon_connect',
    alias: ['connect'],
    legible: 'Amazon Connect',
    sandbox: false,
    gated: true,
    capabilities: {
      telefonia: ['inbound', 'outbound', 'transfer', 'dtmf', 'numberProvisioning'],
      voz: ['streamingStt', 'tts', 'bargeIn'],
      dialogo: ['externalDialog', 'providerDialog', 'humanHandoff'],
      procesos: ['actionGateway'],
    },
    requisitosActivacion: [
      {
        capa: 'TELEFONIA',
        recursos:
          'Instancia de Amazon Connect; números reclamados (DID/toll-free) por región; contact flows; rol IAM con permisos de Connect; opcional SIP trunk vía Chime Voice Connector.',
        faltaCotizar: 'Tarifa por minuto de llamada entrante/saliente y renta mensual por número, por región de Connect.',
      },
      {
        capa: 'VOZ',
        recursos: 'Amazon Transcribe (streaming STT) y Amazon Polly (TTS), o Lex para ASR/NLU; idiomas/voces por región.',
        faltaCotizar: 'Tarifa por minuto de Transcribe, por carácter de Polly y por solicitud de Lex, por región.',
      },
      {
        capa: 'DIALOGO',
        recursos: 'Diálogo externo de NEXO vía Lambda/streaming (preferido) o Amazon Lex; integración con el runtime de agentes.',
        faltaCotizar: 'Tarifa de Lex/Lambda y transferencia de datos, por región.',
      },
      ACTION_GATEWAY_REQ,
    ],
  },
  {
    proveedor: 'google_cloud',
    alias: ['gcp'],
    legible: 'Google Cloud',
    sandbox: false,
    gated: true,
    capabilities: {
      telefonia: ['inbound', 'outbound', 'transfer', 'dtmf'],
      voz: ['streamingStt', 'tts', 'bargeIn', 'wordTimestamps'],
      dialogo: ['externalDialog', 'providerDialog', 'humanHandoff'],
      procesos: ['actionGateway'],
    },
    requisitosActivacion: [
      {
        capa: 'TELEFONIA',
        recursos:
          'Integración de telefonía CCAI (socio de telefonía de Google) o SIP propio; números por región; proyecto GCP con APIs habilitadas y cuenta de servicio.',
        faltaCotizar: 'Tarifa por minuto de telefonía del socio CCAI y renta por número (según socio/región); pendiente de definir el socio.',
      },
      {
        capa: 'VOZ',
        recursos: 'Cloud Speech-to-Text (streaming) y Cloud Text-to-Speech (estándar/WaveNet); idiomas por región.',
        faltaCotizar: 'Tarifa por minuto de Speech-to-Text y por carácter de Text-to-Speech (estándar vs WaveNet), por región.',
      },
      {
        capa: 'DIALOGO',
        recursos: 'Diálogo externo de NEXO (preferido) o Dialogflow CX como motor del proveedor; webhooks al runtime.',
        faltaCotizar: 'Tarifa por solicitud de Dialogflow CX y transferencia de datos, por región.',
      },
      ACTION_GATEWAY_REQ,
    ],
  },
];

/** Busca un proveedor del catálogo por su clave o alias (sin importar mayúsculas/espacios). `null` si no está. */
export function proveedorInfo(proveedor: string): VozProveedorInfo | null {
  const p = proveedor.trim().toLowerCase();
  return VOZ_PROVEEDORES.find((v) => v.proveedor === p || v.alias.includes(p)) ?? null;
}

// ============================ Estado de activación ============================

/** Estado de activación de una cuenta de voz, derivado del proveedor y de si tiene `secretRef`. */
export interface EstadoActivacion {
  /** `true` si el adaptador puede operar llamadas (solo el `simulado`). */
  activo: boolean;
  /** Etiqueta corta para un badge. */
  label: string;
  badge: BadgeClase;
  /** Explicación de la (in)actividad, en español, sin secretos. */
  detalle: string;
}

/**
 * Calcula el estado de activación de una cuenta de voz SIN red (función pura, espejo de `estadoActivacion` +
 * `inactividadStub` del backend): el `simulado` está siempre LISTO; los stubs (Amazon Connect, Google Cloud) quedan
 * INACTIVOS —sin credenciales piden `secretRef`; con credenciales siguen gated por decisión de activación productiva—.
 * Un proveedor desconocido se reporta como no soportado.
 */
export function estadoActivacion(proveedor: string, secretRef: string | null | undefined): EstadoActivacion {
  const info = proveedorInfo(proveedor);
  if (!info) {
    return { activo: false, label: 'No soportado', badge: 'danger', detalle: `Proveedor de voz no soportado: ${proveedor}.` };
  }
  if (info.sandbox) {
    return {
      activo: true,
      label: 'Listo (sandbox)',
      badge: 'info',
      detalle: 'Adaptador simulado: opera el ciclo completo de la llamada sin salir a la red ni requerir credenciales.',
    };
  }
  if (!secretRef) {
    return {
      activo: false,
      label: 'Inactivo · sin credenciales',
      badge: 'warning',
      detalle: `Cuenta de voz ${info.legible} sin credenciales en la bóveda: configure \`secretRef\`. Sin credenciales el adaptador está inactivo y no cursa llamadas.`,
    };
  }
  return {
    activo: false,
    label: 'Inactivo · gated',
    badge: 'warning',
    detalle: `Adaptador de voz ${info.legible} gated (ADR 0015 incremento 5): la activación productiva requiere elegir el proveedor por prueba técnica y evaluación económica. No contacta al proveedor (sin gasto).`,
  };
}

// ============================ Validación de requisitos ============================

/**
 * Valida en el cliente la combinación de requisitos contra las capabilities del proveedor (espejo informativo de
 * `validarCapabilitiesVoz`). Devuelve la lista de incompatibilidades (vacía = válida). El backend revalida siempre.
 */
export function validarRequisitosVoz(
  proveedor: string,
  req: { direccion: 'SALIENTE' | 'ENTRANTE'; transferencia?: boolean; bargeIn?: boolean; dialogo?: VozModoDialogo },
): string[] {
  const info = proveedorInfo(proveedor);
  if (!info) return [`Proveedor de voz no soportado: ${proveedor}.`];
  const caps = info.capabilities;
  const problemas: string[] = [];

  if (req.direccion === 'SALIENTE' && !caps.telefonia.includes('outbound')) {
    problemas.push('La telefonía del proveedor no soporta llamadas salientes.');
  }
  if (req.direccion === 'ENTRANTE' && !caps.telefonia.includes('inbound')) {
    problemas.push('La telefonía del proveedor no soporta llamadas entrantes.');
  }
  if (req.transferencia && !caps.telefonia.includes('transfer')) {
    problemas.push('Se exige transferencia a humano pero la telefonía no la soporta.');
  }
  if (req.transferencia && !caps.dialogo.includes('humanHandoff')) {
    problemas.push('Se exige transferencia a humano pero el motor conversacional no la contempla.');
  }
  if (req.bargeIn && !caps.voz.includes('bargeIn')) {
    problemas.push('Se exige barge-in (interrupción) pero el STT del proveedor no lo soporta.');
  }
  const dialogo = req.dialogo ?? 'externalDialog';
  if (!caps.dialogo.includes(dialogo)) {
    problemas.push(
      dialogo === 'externalDialog'
        ? 'Se exige diálogo controlado por NEXO (externalDialog) pero el proveedor solo ofrece diálogo propio.'
        : 'Se exige diálogo del proveedor (providerDialog) pero el adaptador no lo ofrece.',
    );
  }
  return problemas;
}

/**
 * Modelos del dominio «canal externo» (E14 · ADR 0015). Espejo tipado del contrato de `/canales-externos`:
 * cuentas de canal por empresa (correo/WhatsApp/voz) y mensajes salientes idempotentes. Las credenciales se
 * referencian SIEMPRE por `secretRef` (nombre de la clave de bóveda), NUNCA el secreto en claro.
 */

/** Tipo de canal externo. */
export type CanalTipo = 'CORREO' | 'WHATSAPP' | 'VOZ';

/** Estado de vigencia de una cuenta de canal. */
export type CanalCuentaEstado = 'ACTIVA' | 'SUSPENDIDA' | 'RETIRADA';

/** Dirección de un mensaje de canal. */
export type DireccionMensaje = 'SALIENTE' | 'ENTRANTE';

/**
 * Estado de un mensaje. SIMULADO = despachado por el adaptador simulado (sandbox), sin salida de red.
 * LEIDO = acuse de lectura del destinatario (WhatsApp Meta/Twilio `read`), posterior a ENTREGADO.
 */
export type EstadoMensajeCanal = 'PENDIENTE' | 'ENVIADO' | 'ENTREGADO' | 'LEIDO' | 'FALLIDO' | 'SIMULADO';

/** Cuenta de canal externo por empresa (`GET /canales-externos`). `config` no contiene secretos. */
export interface CanalCuenta {
  id: string;
  workspaceId: string;
  /** Empresa (OrgUnit tipo EMPRESA) dueña de la cuenta. */
  empresaId: string;
  tipo: CanalTipo;
  /** Proveedor concreto (m365 | gmail | smtp | twilio | meta | simulado | …): selecciona el adaptador. */
  proveedor: string;
  estado: CanalCuentaEstado;
  /** Nombre de la clave de bóveda con las credenciales; NUNCA el secreto. `null` = sin credenciales. */
  secretRef: string | null;
  /** Identidad del canal (remitente, etc.), SIN secretos. */
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Mensaje de canal (`GET /canales-externos/:id/mensajes`). */
export interface MensajeCanal {
  id: string;
  workspaceId: string;
  canalCuentaId: string;
  direccion: DireccionMensaje;
  idempotencyKey: string;
  tareaId: string | null;
  misionId: string | null;
  destino: string;
  asunto: string | null;
  cuerpo: string;
  estado: EstadoMensajeCanal;
  proveedorMensajeId: string | null;
  error: string | null;
  /** Aprobación de E6 si el envío la requirió (referencia blanda). */
  aprobacionId: string | null;
  createdAt: string;
}

/** Cuerpo de `POST /canales-externos`. */
export interface CreateCanalCuentaInput {
  empresaId: string;
  tipo: CanalTipo;
  proveedor: string;
  estado?: CanalCuentaEstado;
  /** Nombre de la clave de bóveda (MAYUSCULAS_CON_GUIONES); NUNCA el valor del secreto. */
  secretRef?: string;
  config?: Record<string, unknown>;
}

/** Cuerpo de `PATCH /canales-externos/:id`. */
export type UpdateCanalCuentaInput = Partial<CreateCanalCuentaInput>;

/** Plantilla aprobada de WhatsApp (Meta/Twilio): nombre, idioma y parámetros posicionales del cuerpo, SIN secretos. */
export interface PlantillaMensaje {
  /** Nombre de la plantilla aprobada (Meta) o Content SID (Twilio). */
  nombre: string;
  /** Idioma BCP-47 (ej. es, es_AR, en_US); por defecto `es`. */
  idioma?: string;
  /** Parámetros posicionales del cuerpo; NUNCA secretos. */
  parametros?: string[];
}

/** Tipo de adjunto por referencia (URL pública o media id del proveedor); nunca binarios en el cuerpo. */
export type AdjuntoTipo = 'imagen' | 'documento' | 'audio' | 'video';

/** Adjunto por referencia de un mensaje (ADR 0015/0008): URL pública o `mediaId` del proveedor, no binarios. */
export interface AdjuntoMensaje {
  tipo: AdjuntoTipo;
  /** URL pública del adjunto (validada por el egress seguro). */
  url?: string;
  /** Id de media previamente subido al proveedor (alternativa a `url`). */
  mediaId?: string;
  nombreArchivo?: string;
  caption?: string;
}

/** Cuerpo de `POST /canales-externos/:id/enviar`. Idempotente por `idempotencyKey`. */
export interface EnviarMensajeInput {
  destino: string;
  asunto?: string;
  cuerpo: string;
  idempotencyKey: string;
  tareaId?: string;
  misionId?: string;
  /** Plantilla WhatsApp; si viene, se envía plantilla en vez de texto libre. */
  plantilla?: PlantillaMensaje;
  /** Adjunto por referencia (WhatsApp y otros canales que lo soporten). */
  adjunto?: AdjuntoMensaje;
}

/** Resultado de `POST /canales-externos/:id/test`. */
export interface ResultadoPruebaCanal {
  ok: boolean;
  message: string;
}

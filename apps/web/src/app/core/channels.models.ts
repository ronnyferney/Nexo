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

/** Estado de un mensaje. SIMULADO = despachado por el adaptador simulado (sandbox), sin salida de red. */
export type EstadoMensajeCanal = 'PENDIENTE' | 'ENVIADO' | 'ENTREGADO' | 'FALLIDO' | 'SIMULADO';

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

/** Cuerpo de `POST /canales-externos/:id/enviar`. Idempotente por `idempotencyKey`. */
export interface EnviarMensajeInput {
  destino: string;
  asunto?: string;
  cuerpo: string;
  idempotencyKey: string;
  tareaId?: string;
  misionId?: string;
}

/** Resultado de `POST /canales-externos/:id/test`. */
export interface ResultadoPruebaCanal {
  ok: boolean;
  message: string;
}

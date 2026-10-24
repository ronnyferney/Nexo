import { BadRequestException } from '@nestjs/common';

/**
 * Por qué una conexión o un modelo no se puede usar ahora. Son estados operativos que la cadena de respaldo cubre; un
 * proveedor o modelo inexistente es un error de configuración y no activa el respaldo.
 */
export type UnavailableReason = 'disabled' | 'signed_out' | 'session_expired' | 'model_disabled';

/**
 * La conexión LLM o el modelo de un agente no está disponible (sesión cerrada o revocada, deshabilitado).
 * Es un 400 para el cliente, pero el runtime lo trata como falla recuperable: prueba la cadena de respaldo del agente.
 */
export class ConnectionUnavailableException extends BadRequestException {
  constructor(
    message: string,
    readonly reason: UnavailableReason,
  ) {
    super(message);
  }
}

/**
 * Fallo al obtener una credencial sin claves (intercambio de Workload Identity Federation o STS AssumeRole). El mensaje
 * está en español, es apto para el administrador y nunca incluye tokens ni el cuerpo crudo de la respuesta.
 */
export class KeylessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeylessAuthError';
  }
}

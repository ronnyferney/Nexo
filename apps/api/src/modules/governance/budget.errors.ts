import { HttpException, HttpStatus } from '@nestjs/common';

/** Presupuesto agotado: HTTP 402 Payment Required. */
export class BudgetExceededException extends HttpException {
  constructor(unitName: string, periodKey: string) {
    super(
      `Presupuesto de IA agotado para la unidad "${unitName}" (periodo ${periodKey}). Contacte a su administrador.`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Preset de piloto US$ 0 activo (P0.1b): se intentó usar un proveedor real. Solo se permite el simulador (`mock`) para
 * que el piloto corra con costo externo = 0. HTTP 402 Payment Required (gobierno de gasto).
 */
export class PilotBudgetException extends HttpException {
  constructor(providerId: string) {
    super(
      `Modo piloto activo (presupuesto externo US$ 0): no se permite gastar con el proveedor "${providerId}". ` +
        'Use el proveedor de simulación (mock) o desactive el modo piloto desde Administración.',
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

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

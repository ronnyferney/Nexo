import { Module } from '@nestjs/common';
import { CanalesController } from './canales.controller';
import { CanalesService } from './canales.service';

/**
 * Coordinación transversal (E5 · ADR 0012 D5): canales por misión/proceso/área, hilos y la regla «una solicitud de
 * acción se convierte en tarea autorizada» (no ejecuta sola). Mencionar no concede acceso (QA12). Estas entidades las
 * reutilizará la Comunidad interna (E11).
 */
@Module({
  controllers: [CanalesController],
  providers: [CanalesService],
  exports: [CanalesService],
})
export class CollaborationModule {}

import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Auditoría inmutable (E13). Registro append-only y encadenado por hash de los hechos de gobierno. Es `@Global` para que
 * el gobierno de acciones (aprobaciones, políticas, suspensiones) y el resto de módulos puedan inyectar `AuditService`
 * sin ciclos de módulos ni acoplamiento de más. Importa `AuthModule` por los guards del controlador de solo lectura.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

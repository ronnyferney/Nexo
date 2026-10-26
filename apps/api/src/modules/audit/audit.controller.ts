import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

/**
 * Consola de auditoría inmutable (E13). SOLO LECTURA: no hay endpoints de creación, modificación ni borrado (la
 * auditoría se escribe desde los puntos de gobierno vía `AuditService.append`). Exige `@MinRole('ADMIN')`: la auditoría
 * expone hechos sensibles de gobierno de toda la organización (quién aprobó/rechazó, quién suspendió), así que la
 * reservamos a administración y propiedad del workspace, igual que las políticas y las suspensiones. `workspaceId`
 * SIEMPRE sale de `@CurrentAuth`, nunca del cuerpo o la query.
 */
@ApiTags('auditoria')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('auditoria')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Verifica la integridad de la cadena completa del workspace (ruta explícita antes de `:id`). */
  @Get('verificacion')
  verificar(@CurrentAuth() a: AuthContext) {
    return this.audit.verificarCadena(a.workspaceId);
  }

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: AuditQueryDto) {
    return this.audit.list(a.workspaceId, {
      action: q.action,
      targetType: q.targetType,
      targetId: q.targetId,
      desde: q.desde ? new Date(q.desde) : undefined,
      hasta: q.hasta ? new Date(q.hasta) : undefined,
      take: q.take,
      cursor: q.cursor,
    });
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.audit.get(a.workspaceId, id);
  }
}

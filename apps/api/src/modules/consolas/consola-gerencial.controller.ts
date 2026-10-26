import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ConsolaGerencialService } from './consola-gerencial.service';
import { ConsolaGerencialQueryDto } from './dto/consola-gerencial-query.dto';

/**
 * Consola gerencial (E12 · vista ejecutiva para dirección). Solo lectura. Agrega resultados (E10), economía (E9),
 * estado operativo de gobierno/durabilidad (E6/E7) e integridad de auditoría (E13) para un alcance y período.
 *
 * Rol: `@MinRole('ADMIN')`. Una consola gerencial es una vista de dirección que reúne el estado de gobierno de TODO el
 * workspace (aprobaciones, suspensiones, excepciones, integridad de la cadena) además de las cifras económicas
 * consolidadas; es el mismo nivel exigido por el resto del gobierno sensible (políticas, suspensiones, dimensiones admin).
 * El `workspaceId` SIEMPRE sale de `@CurrentAuth()` (multi-tenant), nunca del cuerpo/query.
 */
@ApiTags('consolas')
@ApiBearerAuth()
@Controller('consolas')
export class ConsolaGerencialController {
  constructor(private readonly consola: ConsolaGerencialService) {}

  /** Resumen ejecutivo del alcance/período: resultados + economía + gobierno + integridad de auditoría. */
  @MinRole('ADMIN')
  @Get('gerencial')
  gerencial(@CurrentAuth() a: AuthContext, @Query() query: ConsolaGerencialQueryDto) {
    return this.consola.gerencial(a.workspaceId, query);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateEstacionVirtualDto, UpdateEstacionVirtualDto } from './dto/estacion-virtual.dto';
import { EstacionesVirtualesService } from './estaciones-virtuales.service';

/**
 * Estaciones virtuales (E8): recurso de infraestructura del workspace. La lectura es para cualquier miembro (VIEWER+);
 * crear, editar y retirar son decisiones de infraestructura reservadas a ADMIN+. `workspaceId` SIEMPRE de
 * `@CurrentAuth()` (multi-tenant). NUNCA se guardan credenciales ni secretos (solo etiquetas).
 */
@ApiTags('estaciones-virtuales')
@ApiBearerAuth()
@Controller('estaciones-virtuales')
export class EstacionesVirtualesController {
  constructor(private readonly estaciones: EstacionesVirtualesService) {}

  @MinRole('VIEWER')
  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.estaciones.list(a.workspaceId);
  }

  @MinRole('VIEWER')
  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.estaciones.get(a.workspaceId, id);
  }

  @MinRole('ADMIN')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateEstacionVirtualDto) {
    return this.estaciones.create(a, dto);
  }

  @MinRole('ADMIN')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateEstacionVirtualDto) {
    return this.estaciones.update(a, id, dto);
  }

  /** Baja lógica: la estación pasa a RETIRADA (no se borra). Los agentes asignados conservan el vínculo histórico. */
  @MinRole('ADMIN')
  @Delete(':id')
  retirar(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.estaciones.retirar(a, id);
  }
}

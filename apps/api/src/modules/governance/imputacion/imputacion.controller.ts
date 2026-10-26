import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { ConsolidacionService } from './consolidacion.service';
import {
  ConsolidacionQueryDto,
  CreateServicioInternoDto,
  RepartoQueryDto,
  ServiciosQueryDto,
  SetRepartoDto,
  UpdateServicioInternoDto,
} from './dto/imputacion.dto';
import { ServiciosInternosService } from './servicios-internos.service';

/**
 * Servicios internos / compartidos y su reparto de costo (ADR 0011 D5 / E9 · RF44/RF45). Lectura para cualquier miembro;
 * mutaciones EDITOR+. Todo se acota por `workspaceId` de `@CurrentAuth()` (nunca del cuerpo). El reparto es de reporte:
 * NO toca presupuestos ni reservas (ADR 0002 intacto) y NO concede acceso a datos (D6).
 */
@ApiTags('servicios-internos')
@ApiBearerAuth()
@Controller('servicios-internos')
export class ServiciosInternosController {
  constructor(private readonly servicios: ServiciosInternosService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: ServiciosQueryDto) {
    return this.servicios.listServicios(a.workspaceId, q.empresaId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.servicios.getServicio(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateServicioInternoDto) {
    return this.servicios.createServicio(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateServicioInternoDto) {
    return this.servicios.updateServicio(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.servicios.removeServicio(a.workspaceId, id);
  }

  // ---------------------------- Reparto (imputaciones) ----------------------------

  @Get(':id/imputaciones')
  getReparto(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query() q: RepartoQueryDto) {
    return this.servicios.getReparto(a.workspaceId, id, q.periodoKey);
  }

  /** Reemplaza el reparto completo del servicio para el periodo del cuerpo (suma 100 %, sin destinos repetidos). */
  @MinRole('EDITOR')
  @Put(':id/imputaciones')
  setReparto(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetRepartoDto) {
    return this.servicios.setReparto(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/imputaciones')
  @HttpCode(204)
  removeReparto(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query('periodoKey') periodoKey: string) {
    return this.servicios.removeReparto(a.workspaceId, id, periodoKey);
  }
}

/**
 * Consolidación económica (ADR 0011 D7 / E9 · RF47 parcial): costo por empresa / línea / área / centro de costo, con el
 * costo medido y el estimado (reparto de servicios compartidos) diferenciados. Solo lectura, acotada por el workspace.
 */
@ApiTags('consolidacion')
@ApiBearerAuth()
@Controller('consolidacion')
export class ConsolidacionController {
  constructor(private readonly consolidacion: ConsolidacionService) {}

  @Get()
  consolidar(@CurrentAuth() a: AuthContext, @Query() q: ConsolidacionQueryDto) {
    return this.consolidacion.consolidar(a.workspaceId, q);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { ConsolasService } from './consolas.service';
import { DimensionesService } from './dimensiones.service';
import {
  AnalisisQueryDto,
  CreateDimensionAssignmentDto,
  CreateDimensionDto,
  CreateDimensionValueDto,
  DimensionesQueryDto,
  UpdateDimensionDto,
  UpdateDimensionValueDto,
  ValidarEfectoEconomicoDto,
} from './dto/dimensiones.dto';

/**
 * Marco de dimensiones configurables (ADR 0011 D8). Lectura para cualquier miembro del workspace; las mutaciones exigen
 * EDITOR+. Todo se acota por `workspaceId` de `@CurrentAuth()` (nunca del cuerpo). Etiquetar NO concede acceso (D6).
 */
@ApiTags('dimensiones')
@ApiBearerAuth()
@Controller('dimensiones')
export class DimensionesController {
  constructor(private readonly dimensiones: DimensionesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: DimensionesQueryDto) {
    return this.dimensiones.listDimensiones(a.workspaceId, q.empresaId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.dimensiones.getDimension(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateDimensionDto) {
    return this.dimensiones.createDimension(a.workspaceId, dto);
  }

  /** Comprueba, al despachar trabajo con efecto económico, que no falte el valor de una dimensión obligatoria (D8). */
  @Post('efecto-economico/validar')
  @HttpCode(200)
  async validarEfectoEconomico(@CurrentAuth() a: AuthContext, @Body() dto: ValidarEfectoEconomicoDto) {
    await this.dimensiones.assertSnapshotCompleto(a.workspaceId, dto.dimensiones, {
      aplicaA: dto.aplicaA,
      empresaId: dto.empresaId ?? undefined,
      efectoEconomico: true,
    });
    return { ok: true };
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateDimensionDto) {
    return this.dimensiones.updateDimension(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.dimensiones.removeDimension(a.workspaceId, id);
  }

  // ---------------------------- Valores ----------------------------

  @Get(':id/valores')
  listValores(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.dimensiones.listValores(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/valores')
  createValor(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateDimensionValueDto) {
    return this.dimensiones.createValor(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id/valores/:valorId')
  updateValor(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @Param('valorId') valorId: string,
    @Body() dto: UpdateDimensionValueDto,
  ) {
    return this.dimensiones.updateValor(a.workspaceId, id, valorId, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/valores/:valorId')
  @HttpCode(204)
  removeValor(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('valorId') valorId: string) {
    return this.dimensiones.removeValor(a.workspaceId, id, valorId);
  }

  // ---------------------------- Etiquetado ----------------------------

  @Get(':id/asignaciones')
  listAsignaciones(
    @CurrentAuth() a: AuthContext,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
  ) {
    return this.dimensiones.listAsignaciones(a.workspaceId, targetType, targetId);
  }

  @MinRole('EDITOR')
  @Post(':id/asignaciones')
  asignar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateDimensionAssignmentDto) {
    return this.dimensiones.asignar(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete('asignaciones/:asignacionId')
  @HttpCode(204)
  quitarAsignacion(@CurrentAuth() a: AuthContext, @Param('asignacionId') asignacionId: string) {
    return this.dimensiones.quitarAsignacion(a.workspaceId, asignacionId);
  }
}

/**
 * Consola de análisis (ADR 0011 D7/D8): pivota el consumo por cualquier dimensión configurada. Solo lectura, acotada
 * por el workspace de `@CurrentAuth()`.
 */
@ApiTags('consolas')
@ApiBearerAuth()
@Controller('consolas')
export class ConsolasController {
  constructor(private readonly consolas: ConsolasService) {}

  @Get('analisis')
  analisis(@CurrentAuth() a: AuthContext, @Query() q: AnalisisQueryDto) {
    return this.consolas.analisis(a.workspaceId, q.groupBy, q.from, q.to);
  }
}

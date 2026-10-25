import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { AsignacionesService } from './asignaciones.service';
import { CatalogosService } from './catalogos.service';
import {
  CreateAsignacionDto,
  CreateCentroCostoDto,
  CreateLineaNegocioDto,
  CreateSedeDto,
  EstructuraQueryDto,
  UpdateAsignacionDto,
  UpdateCentroCostoDto,
  UpdateLineaNegocioDto,
  UpdateSedeDto,
} from './dto/estructura.dto';

/**
 * CRUD de la estructura empresarial (ADR 0011 E1). Lectura para cualquier miembro del workspace; las mutaciones exigen
 * EDITOR+. Todo se acota por `workspaceId` de `@CurrentAuth()` (nunca del cuerpo) y, opcionalmente, por empresa.
 * Estas entidades describen estructura: NO conceden acceso a datos ni herramientas por sí mismas (D6/RF46).
 */
@ApiTags('estructura')
@ApiBearerAuth()
@Controller('estructura')
export class EstructuraController {
  constructor(
    private readonly catalogos: CatalogosService,
    private readonly asignaciones: AsignacionesService,
  ) {}

  // ---------------------------- Líneas de negocio ----------------------------

  @Get('lineas-negocio')
  listLineas(@CurrentAuth() a: AuthContext, @Query() q: EstructuraQueryDto) {
    return this.catalogos.listLineas(a.workspaceId, q.empresaId);
  }

  @Get('lineas-negocio/:id')
  getLinea(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.getLinea(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('lineas-negocio')
  createLinea(@CurrentAuth() a: AuthContext, @Body() dto: CreateLineaNegocioDto) {
    return this.catalogos.createLinea(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch('lineas-negocio/:id')
  updateLinea(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateLineaNegocioDto) {
    return this.catalogos.updateLinea(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete('lineas-negocio/:id')
  @HttpCode(204)
  removeLinea(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.removeLinea(a.workspaceId, id);
  }

  // ---------------------------- Sedes ----------------------------

  @Get('sedes')
  listSedes(@CurrentAuth() a: AuthContext, @Query() q: EstructuraQueryDto) {
    return this.catalogos.listSedes(a.workspaceId, q.empresaId);
  }

  @Get('sedes/:id')
  getSede(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.getSede(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('sedes')
  createSede(@CurrentAuth() a: AuthContext, @Body() dto: CreateSedeDto) {
    return this.catalogos.createSede(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch('sedes/:id')
  updateSede(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateSedeDto) {
    return this.catalogos.updateSede(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete('sedes/:id')
  @HttpCode(204)
  removeSede(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.removeSede(a.workspaceId, id);
  }

  // ---------------------------- Centros de costo ----------------------------

  @Get('centros-costo')
  listCentros(@CurrentAuth() a: AuthContext, @Query() q: EstructuraQueryDto) {
    return this.catalogos.listCentros(a.workspaceId, q.empresaId);
  }

  @Get('centros-costo/:id')
  getCentro(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.getCentro(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('centros-costo')
  createCentro(@CurrentAuth() a: AuthContext, @Body() dto: CreateCentroCostoDto) {
    return this.catalogos.createCentro(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch('centros-costo/:id')
  updateCentro(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateCentroCostoDto) {
    return this.catalogos.updateCentro(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete('centros-costo/:id')
  @HttpCode(204)
  removeCentro(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.catalogos.removeCentro(a.workspaceId, id);
  }

  // ---------------------------- Asignaciones (matriz) ----------------------------

  @Get('asignaciones')
  listAsignaciones(
    @CurrentAuth() a: AuthContext,
    @Query('agentId') agentId?: string,
    @Query('userId') userId?: string,
    @Query('lineaNegocioId') lineaNegocioId?: string,
  ) {
    return this.asignaciones.list(a.workspaceId, { agentId, userId, lineaNegocioId });
  }

  @Get('asignaciones/:id')
  getAsignacion(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.asignaciones.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('asignaciones')
  createAsignacion(@CurrentAuth() a: AuthContext, @Body() dto: CreateAsignacionDto) {
    return this.asignaciones.create(a.workspaceId, dto, a.userId);
  }

  @MinRole('EDITOR')
  @Patch('asignaciones/:id')
  updateAsignacion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateAsignacionDto) {
    return this.asignaciones.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete('asignaciones/:id')
  @HttpCode(204)
  removeAsignacion(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.asignaciones.remove(a.workspaceId, id);
  }
}

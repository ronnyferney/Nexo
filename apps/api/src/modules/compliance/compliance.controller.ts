import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import {
  CreateReglaCumplimientoDto,
  ResolverCumplimientoDto,
  UpdateReglaCumplimientoDto,
  ValidarCumplimientoDto,
} from './dto/regla-cumplimiento.dto';
import { ReglasCumplimientoService } from './reglas-cumplimiento.service';

/**
 * CRUD GOBERNADO de la matriz de cumplimiento configurable (P1.3 · ADR 0020). Solo ADMIN/OWNER del cliente: definir
 * reglas de cumplimiento es un acto de gobierno sensible, auditado en E13. Todo filtra por `workspaceId` de
 * `@CurrentAuth()` (aislamiento multi-tenant). Las reglas NACEN INACTIVAS: no exigen nada hasta que un ADMIN las active
 * y el patrocinador apruebe el conjunto definitivo. No afirma conformidad con ninguna norma.
 */
@ApiTags('cumplimiento')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/compliance/rules')
export class ReglasCumplimientoController {
  constructor(private readonly reglas: ReglasCumplimientoService) {}

  @ApiOperation({ summary: 'Lista las reglas de cumplimiento del workspace (de la más específica a la general)' })
  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.reglas.list(a.workspaceId);
  }

  @ApiOperation({ summary: 'Obtiene una regla de cumplimiento por id' })
  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.reglas.get(a.workspaceId, id);
  }

  @ApiOperation({ summary: 'Crea una regla de cumplimiento (nace INACTIVA por defecto)' })
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateReglaCumplimientoDto) {
    return this.reglas.create(a, dto);
  }

  @ApiOperation({ summary: 'Actualiza una regla de cumplimiento (activar/desactivar queda auditado)' })
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateReglaCumplimientoDto) {
    return this.reglas.update(a, id, dto);
  }

  @ApiOperation({ summary: 'Elimina una regla de cumplimiento' })
  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.reglas.remove(a, id);
  }
}

/**
 * Lectura ASESORA de la matriz de cumplimiento (P1.3 · ADR 0020): resolución del conjunto de reglas aplicables a un
 * contexto y evaluación (no bloqueante) de un resultado/pasaporte. Legible por VIEWER+ con alcance al workspace (todo
 * filtra por `workspaceId` de `@CurrentAuth()`): no modifica datos ni bloquea; solo informa cumple/faltantes.
 */
@ApiTags('cumplimiento')
@ApiBearerAuth()
@MinRole('VIEWER')
@Controller('compliance')
export class CumplimientoController {
  constructor(private readonly reglas: ReglasCumplimientoService) {}

  @ApiOperation({ summary: 'Resuelve el conjunto de reglas aplicables a un contexto (la más específica suma)' })
  @Get('resolve')
  resolve(@CurrentAuth() a: AuthContext, @Query() q: ResolverCumplimientoDto) {
    const { incluirInactivas, ...contexto } = q;
    return this.reglas.resolver(a.workspaceId, contexto, incluirInactivas ?? false);
  }

  @ApiOperation({ summary: 'Evalúa de forma ASESORA (no bloqueante) un resultado/pasaporte contra las reglas activas' })
  @Post('validate')
  @HttpCode(200)
  validate(@CurrentAuth() a: AuthContext, @Body() dto: ValidarCumplimientoDto) {
    return this.reglas.validar(a.workspaceId, dto.contexto, dto.valores);
  }
}

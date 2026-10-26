import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ChannelsService } from './channels.service';
import { CreateCanalCuentaDto, EnviarMensajeDto, ListMensajesQueryDto, UpdateCanalCuentaDto } from './dto/channel.dto';

/**
 * Canales externos (E14 · ADR 0015). CRUD de cuentas de canal por empresa y envío idempotente de mensajes. Crear y
 * editar cuentas exige ADMIN (gestionan credenciales por `secretRef`); leer basta con VIEWER. El envío exige EDITOR y
 * pasa por el gobierno de E6 para cuentas productivas. `workspaceId` siempre de `@CurrentAuth()`.
 *
 * Ruta base `canales-externos` (no `canales`): el prefijo `canales` ya lo usa la coordinación interna de agentes
 * (E5, `modules/collaboration`); este dominio es el de los canales EXTERNOS (correo/WhatsApp/voz).
 */
@ApiTags('canales-externos')
@ApiBearerAuth()
@Controller('canales-externos')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.channels.list(a.workspaceId);
  }

  @Get(':cuentaId')
  get(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string) {
    return this.channels.get(a.workspaceId, cuentaId);
  }

  @MinRole('ADMIN')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateCanalCuentaDto) {
    return this.channels.create(a, dto);
  }

  @MinRole('ADMIN')
  @Patch(':cuentaId')
  update(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string, @Body() dto: UpdateCanalCuentaDto) {
    return this.channels.update(a.workspaceId, cuentaId, dto);
  }

  @MinRole('ADMIN')
  @Delete(':cuentaId')
  remove(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string) {
    return this.channels.remove(a.workspaceId, cuentaId);
  }

  // Provoca una autenticación saliente con las credenciales de la cuenta: no basta con poder leerla.
  @MinRole('ADMIN')
  @HttpCode(200)
  @Post(':cuentaId/test')
  test(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string) {
    return this.channels.test(a.workspaceId, cuentaId);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':cuentaId/enviar')
  enviar(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string, @Body() dto: EnviarMensajeDto) {
    return this.channels.enviar(a, cuentaId, dto);
  }

  @Get(':cuentaId/mensajes')
  mensajes(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string, @Query() query: ListMensajesQueryDto) {
    return this.channels.listMensajes(a.workspaceId, cuentaId, query.estado);
  }
}

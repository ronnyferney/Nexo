import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { EnviarMensajeDto, HechoMensajeDto } from './dto/mensaje.dto';
import { MensajesService } from './mensajes.service';

/**
 * Protocolo de mensajes entre agentes (E5 · RF35). Lectura para cualquier miembro; enviar y marcar hechos del ciclo
 * de vida requieren EDITOR+. El envío es idempotente por `messageId` (una redelivery no crea otra tarea, QA11).
 */
@ApiTags('mensajes')
@ApiBearerAuth()
@Controller('mensajes')
export class MensajesController {
  constructor(private readonly mensajes: MensajesService) {}

  @Get()
  list(
    @CurrentAuth() a: AuthContext,
    @Query('correlationId') correlationId?: string,
    @Query('tareaId') tareaId?: string,
    @Query('destinatarioAgentId') destinatarioAgentId?: string,
  ) {
    return this.mensajes.list(a.workspaceId, { correlationId, tareaId, destinatarioAgentId });
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.mensajes.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  enviar(@CurrentAuth() a: AuthContext, @Body() dto: EnviarMensajeDto) {
    return this.mensajes.enviar(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/recibir')
  recibir(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: HechoMensajeDto) {
    return this.mensajes.recibir(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/aceptar')
  aceptar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: HechoMensajeDto) {
    return this.mensajes.aceptar(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/resolver')
  resolver(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: HechoMensajeDto) {
    return this.mensajes.resolver(a.workspaceId, id, dto);
  }
}

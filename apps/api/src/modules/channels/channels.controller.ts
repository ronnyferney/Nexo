import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
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

  /**
   * Webhook entrante de un proveedor (Meta/Twilio). Endpoint PÚBLICO (sin sesión): la autenticación es la VERIFICACIÓN
   * DE FIRMA del proveedor con el secreto de la cuenta (`X-Hub-Signature-256` de Meta sobre el cuerpo crudo;
   * `X-Twilio-Signature` sobre url+params). Firma inválida ⇒ 401. Se usa el cuerpo CRUDO (`req.rawBody`, por
   * `rawBody: true` en el bootstrap) para la firma HMAC de Meta y la URL absoluta para la de Twilio. Throttling por IP.
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @Post('webhooks/:proveedor/:cuentaId')
  webhook(
    @Param('proveedor') proveedor: string,
    @Param('cuentaId') cuentaId: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : (v ?? '');
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const url = `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`;
    return this.channels.recibirWebhook(proveedor, cuentaId, { headers, body: req.body, rawBody, url });
  }
}

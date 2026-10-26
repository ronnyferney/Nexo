import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import {
  CreateVoiceCuentaDto,
  IniciarLlamadaDto,
  ListLlamadasQueryDto,
  TransferirLlamadaDto,
  TurnoLlamadaDto,
} from './dto/voice.dto';
import { VoiceService } from './voice.service';

/**
 * Voz (E14 · ADR 0015 D2), sandbox SIN gasto. Cuentas de voz por empresa (reusa `CanalCuenta` tipo VOZ) y ciclo de
 * llamada por el adaptador del proveedor: iniciar → turnos → transferir → finalizar. Crear cuentas exige ADMIN
 * (credenciales por `secretRef`); operar llamadas exige EDITOR (tiene efecto y pasa por el gobierno de E6 en la capa d);
 * leer basta con VIEWER. `workspaceId` siempre de `@CurrentAuth()`.
 */
@ApiTags('voz')
@ApiBearerAuth()
@Controller('voz')
export class VoiceController {
  constructor(private readonly voz: VoiceService) {}

  @Get('cuentas')
  listCuentas(@CurrentAuth() a: AuthContext) {
    return this.voz.listCuentas(a.workspaceId);
  }

  @Get('cuentas/:cuentaId')
  getCuenta(@CurrentAuth() a: AuthContext, @Param('cuentaId') cuentaId: string) {
    return this.voz.getCuenta(a.workspaceId, cuentaId);
  }

  @MinRole('ADMIN')
  @Post('cuentas')
  createCuenta(@CurrentAuth() a: AuthContext, @Body() dto: CreateVoiceCuentaDto) {
    return this.voz.createCuenta(a, dto);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('llamadas')
  iniciar(@CurrentAuth() a: AuthContext, @Body() dto: IniciarLlamadaDto) {
    return this.voz.iniciar(a, dto);
  }

  @Get('llamadas')
  listLlamadas(@CurrentAuth() a: AuthContext, @Query() query: ListLlamadasQueryDto) {
    return this.voz.listLlamadas(a.workspaceId, query.cuentaId, query.estado);
  }

  @Get('llamadas/:callId')
  getLlamada(@CurrentAuth() a: AuthContext, @Param('callId') callId: string) {
    return this.voz.getLlamada(a.workspaceId, callId);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('llamadas/:callId/turno')
  turno(@CurrentAuth() a: AuthContext, @Param('callId') callId: string, @Body() dto: TurnoLlamadaDto) {
    return this.voz.turno(a, callId, dto);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('llamadas/:callId/transferir')
  transferir(@CurrentAuth() a: AuthContext, @Param('callId') callId: string, @Body() dto: TransferirLlamadaDto) {
    return this.voz.transferir(a, callId, dto);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('llamadas/:callId/finalizar')
  finalizar(@CurrentAuth() a: AuthContext, @Param('callId') callId: string) {
    return this.voz.finalizar(a, callId);
  }
}

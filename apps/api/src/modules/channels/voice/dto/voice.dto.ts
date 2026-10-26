import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CanalCuentaEstado, DireccionMensaje } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SECRET_NAME_PATTERN } from '../../../connectors/domain/secret-refs';

/** Proveedor de voz: etiqueta corta en minúsculas (simulado | amazon_connect | google_cloud | ...). */
const PROVEEDOR_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/** Crea una cuenta de voz (CanalCuenta tipo VOZ) por empresa. Solo ADMIN+. Credenciales SOLO por `secretRef`. */
export class CreateVoiceCuentaDto {
  @ApiProperty({ description: 'Empresa (OrgUnit tipo EMPRESA) dueña de la cuenta' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  empresaId!: string;

  @ApiProperty({ description: 'Proveedor de voz (simulado | amazon_connect | google_cloud | ...)' })
  @Matches(PROVEEDOR_PATTERN, { message: 'Proveedor en minúsculas (ej. simulado, amazon_connect)' })
  proveedor!: string;

  @ApiPropertyOptional({ enum: CanalCuentaEstado, default: 'ACTIVA' })
  @IsOptional()
  @IsEnum(CanalCuentaEstado)
  estado?: CanalCuentaEstado;

  @ApiPropertyOptional({ description: 'Nombre de la clave de bóveda con credenciales; NUNCA el secreto en claro' })
  @IsOptional()
  @Matches(SECRET_NAME_PATTERN, { message: 'Nombre de secreto en MAYUSCULAS_CON_GUIONES (ej. CONNECT_CREDS)' })
  secretRef?: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'Identidad del canal (número, región, capabilities), SIN secretos',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/** Requisitos de la llamada; el servicio valida la combinación contra las capabilities y bloquea las incompatibles. */
export class RequisitosVozDto {
  @ApiPropertyOptional({ description: 'Exige poder transferir a un humano' })
  @IsOptional()
  @IsBoolean()
  transferencia?: boolean;

  @ApiPropertyOptional({ description: 'Exige barge-in (interrupción del usuario sobre el TTS)' })
  @IsOptional()
  @IsBoolean()
  bargeIn?: boolean;

  @ApiPropertyOptional({ enum: ['externalDialog', 'providerDialog'], default: 'externalDialog' })
  @IsOptional()
  @IsIn(['externalDialog', 'providerDialog'])
  dialogo?: 'externalDialog' | 'providerDialog';
}

export class IniciarLlamadaDto {
  @ApiProperty({ description: 'Cuenta de voz (CanalCuenta tipo VOZ) que origina/recibe la llamada' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cuentaId!: string;

  @ApiProperty({ enum: DireccionMensaje })
  @IsEnum(DireccionMensaje)
  direccion!: DireccionMensaje;

  @ApiProperty({ description: 'Número destino (saliente) u origen (entrante)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  numero!: string;

  @ApiProperty({ description: 'Clave de idempotencia: un reintento no origina dos llamadas' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string;

  @ApiPropertyOptional({ type: RequisitosVozDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RequisitosVozDto)
  requisitos?: RequisitosVozDto;

  @ApiPropertyOptional({ description: 'Tarea (E5) que origina la llamada' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tareaId?: string;

  @ApiPropertyOptional({ description: 'Misión (E5) que origina la llamada' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  misionId?: string;
}

/** Un turno conversacional: texto del usuario (STT). Dato NO confiable. */
export class TurnoLlamadaDto {
  @ApiProperty({ description: 'Texto del usuario reconocido por STT en este turno' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  entrada!: string;

  @ApiPropertyOptional({ description: 'El usuario interrumpió el TTS (barge-in)' })
  @IsOptional()
  @IsBoolean()
  bargeIn?: boolean;
}

/** Transferencia a humano. */
export class TransferirLlamadaDto {
  @ApiProperty({ description: 'Destino humano de la transferencia (cola/extensión/número)' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  destino!: string;
}

/** Filtro de la bandeja de llamadas: cuenta de voz obligatoria y estado opcional. */
export class ListLlamadasQueryDto {
  @ApiProperty({ description: 'Cuenta de voz cuyas llamadas se listan' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cuentaId!: string;

  @ApiPropertyOptional({ enum: ['INICIADA', 'EN_CURSO', 'TRANSFERIDA', 'FINALIZADA', 'FALLIDA', 'SIMULADA'] })
  @IsOptional()
  @IsString()
  estado?: string;
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CanalCuentaEstado, CanalTipo } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import { SECRET_NAME_PATTERN } from '../../connectors/domain/secret-refs';

/** Proveedor: etiqueta corta en minúsculas (m365 | gmail | smtp | twilio | meta | simulado | ...). */
const PROVEEDOR_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export class CreateCanalCuentaDto {
  @ApiProperty({ description: 'Empresa (OrgUnit tipo EMPRESA) dueña de la cuenta' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  empresaId!: string;

  @ApiProperty({ enum: CanalTipo })
  @IsEnum(CanalTipo)
  tipo!: CanalTipo;

  @ApiProperty({ description: 'Proveedor (m365 | gmail | smtp | twilio | meta | simulado | ...)' })
  @Matches(PROVEEDOR_PATTERN, { message: 'Proveedor en minúsculas (ej. m365, simulado)' })
  proveedor!: string;

  @ApiPropertyOptional({ enum: CanalCuentaEstado, default: 'ACTIVA' })
  @IsOptional()
  @IsEnum(CanalCuentaEstado)
  estado?: CanalCuentaEstado;

  @ApiPropertyOptional({ description: 'Nombre de la clave de bóveda con las credenciales; NUNCA el secreto en claro' })
  @IsOptional()
  @Matches(SECRET_NAME_PATTERN, { message: 'Nombre de secreto en MAYUSCULAS_CON_GUIONES (ej. M365_CLIENT_SECRET)' })
  secretRef?: string;

  @ApiPropertyOptional({ type: Object, description: 'Identidad del canal (remitente, etc.), SIN secretos' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateCanalCuentaDto extends PartialType(CreateCanalCuentaDto) {}

/** Plantilla aprobada de WhatsApp (Meta/Twilio): nombre, idioma y parámetros posicionales del cuerpo, SIN secretos. */
export class PlantillaMensajeDto {
  @ApiProperty({ description: 'Nombre de la plantilla aprobada (Meta) o Content SID (Twilio)' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Idioma BCP-47 (ej. es, es_AR, en_US)', default: 'es' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  idioma?: string;

  @ApiPropertyOptional({ type: [String], description: 'Parámetros posicionales del cuerpo; NUNCA secretos' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  parametros?: string[];
}

/** Adjunto por referencia (URL pública o media id del proveedor); nunca binarios en el cuerpo (ADR 0015/0008). */
export class AdjuntoMensajeDto {
  @ApiProperty({ enum: ['imagen', 'documento', 'audio', 'video'] })
  @IsIn(['imagen', 'documento', 'audio', 'video'])
  tipo!: 'imagen' | 'documento' | 'audio' | 'video';

  @ApiPropertyOptional({ description: 'URL pública del adjunto (validada por el egress seguro)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ description: 'Id de media previamente subido al proveedor (alternativa a url)' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  mediaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nombreArchivo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class EnviarMensajeDto {
  @ApiProperty({ description: 'Destino (correo, número, ...)' })
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  destino!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  asunto?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  cuerpo!: string;

  @ApiProperty({ description: 'Clave de idempotencia (única por workspace): un reintento no duplica el envío' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Tarea (E5) que origina el mensaje' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tareaId?: string;

  @ApiPropertyOptional({ description: 'Misión (E5) que origina el mensaje' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  misionId?: string;

  @ApiPropertyOptional({ type: PlantillaMensajeDto, description: 'Plantilla WhatsApp; si viene, se envía plantilla' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlantillaMensajeDto)
  plantilla?: PlantillaMensajeDto;

  @ApiPropertyOptional({ type: AdjuntoMensajeDto, description: 'Adjunto por referencia' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdjuntoMensajeDto)
  adjunto?: AdjuntoMensajeDto;
}

/** Filtro opcional de la bandeja de mensajes. */
export class ListMensajesQueryDto {
  @ApiPropertyOptional({ enum: ['PENDIENTE', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO', 'SIMULADO'] })
  @IsOptional()
  @IsString()
  estado?: string;
}

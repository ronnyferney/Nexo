import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Debe coincidir con el enum `TipoMensaje` de Prisma. */
export const TIPOS_MENSAJE = [
  'ASIGNACION',
  'ACEPTACION',
  'SOLICITUD_INFO',
  'ENTREGA',
  'DEVOLUCION',
  'BLOQUEO',
  'ESCALAMIENTO',
  'CIERRE',
  'HANDOFF',
] as const;
export type TipoMensajeDto = (typeof TIPOS_MENSAJE)[number];

/** Datos mínimos para derivar la tarea asignada de un mensaje de ASIGNACION (la acción se ejecuta una sola vez). */
export class TareaAsignadaDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titulo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  criterioAceptacion?: string;

  @ApiPropertyOptional({ description: 'Tarea padre (cadena de delegación, RF10)' })
  @IsOptional()
  @IsString()
  parentTareaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  entradas?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Fecha límite de la tarea (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  fechaLimite?: string;
}

/**
 * Envío de un mensaje entre agentes (RF35). `messageId` es la clave de idempotencia provista por el emisor: una
 * redelivery del mismo `messageId` devuelve el mensaje existente SIN crear otra tarea ni otro efecto (QA11).
 */
export class EnviarMensajeDto {
  @ApiProperty({ description: 'Clave de idempotencia del emisor (única por workspace)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  messageId!: string;

  @ApiProperty({ enum: TIPOS_MENSAJE })
  @IsIn(TIPOS_MENSAJE)
  tipo!: TipoMensajeDto;

  @ApiPropertyOptional({ description: 'Hilo de negocio (correlación)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;

  @ApiPropertyOptional({ description: 'Empresa (OrgUnit tipo EMPRESA, referencia blanda)' })
  @IsOptional()
  @IsString()
  empresaId?: string;

  @ApiPropertyOptional({ description: 'Agente emisor (referencia blanda)' })
  @IsOptional()
  @IsString()
  emisorAgentId?: string;

  @ApiPropertyOptional({ description: 'Agente destinatario (referencia blanda)' })
  @IsOptional()
  @IsString()
  destinatarioAgentId?: string;

  @ApiPropertyOptional({ description: 'Equipo/grupo destinatario (referencia blanda)' })
  @IsOptional()
  @IsString()
  destinatarioEquipoId?: string;

  @ApiPropertyOptional({ description: 'Canal de coordinación (referencia blanda)' })
  @IsOptional()
  @IsString()
  canalId?: string;

  @ApiPropertyOptional({ description: 'Objetivo/misión (referencia blanda)' })
  @IsOptional()
  @IsString()
  misionId?: string;

  @ApiPropertyOptional({ description: 'Tarea asociada ya existente' })
  @IsOptional()
  @IsString()
  tareaId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  prioridad?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ description: 'Plazo de respuesta/confirmación (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  fechaLimite?: string;

  @ApiPropertyOptional({ description: 'Referencias autorizadas (punteros, no copia de datos sensibles)' })
  @IsOptional()
  @IsArray()
  referencias?: unknown[];

  @ApiPropertyOptional({ description: 'Alcance que acompaña; NUNCA amplía atribuciones (se rechaza si lo intenta)' })
  @IsOptional()
  @IsObject()
  permisos?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: TareaAsignadaDto,
    description: 'Para ASIGNACION sin tareaId: crea la tarea una sola vez',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TareaAsignadaDto)
  tarea?: TareaAsignadaDto;
}

/** Marca un hecho de ciclo de vida del mensaje (recibir/aceptar/resolver) con su actor y motivo (RF35). */
export class HechoMensajeDto {
  @ApiPropertyOptional({ description: 'Agente que ejecuta el hecho (referencia blanda)' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'Motivo/código auditable (obligatorio en DEVOLUCION/rechazo)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;
}

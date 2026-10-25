import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
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
} from 'class-validator';

/** Debe coincidir con el enum `EstadoTarea` de Prisma. */
export const ESTADOS_TAREA = [
  'PENDIENTE',
  'EN_EJECUCION',
  'ESPERANDO_APROBACION',
  'BLOQUEADA',
  'EN_REVISION',
  'COMPLETADA',
  'FALLIDA_CANCELADA',
] as const;
export type EstadoTareaDto = (typeof ESTADOS_TAREA)[number];

/** Debe coincidir con el enum `TipoResultado` de Prisma. */
export const TIPOS_RESULTADO = ['PRODUCTO_INTERMEDIO', 'RESULTADO_NEGOCIO'] as const;
export type TipoResultadoDto = (typeof TIPOS_RESULTADO)[number];

export class CreateTareaDto {
  @ApiProperty({ description: 'Título de la tarea' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titulo!: string;

  @ApiPropertyOptional({ description: 'Descripción de la tarea' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Objetivo al que pertenece la tarea' })
  @IsOptional()
  @IsString()
  objetivoId?: string;

  @ApiPropertyOptional({ description: 'Empresa / área (OrgUnit, referencia blanda)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional({ description: 'Criterio de aceptación (qué se considera hecho)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  criterioAceptacion?: string;

  @ApiPropertyOptional({ description: 'Entradas de la tarea (datos / referencias)' })
  @IsOptional()
  @IsObject()
  entradas?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Responsable digital ejecutor (Agent, referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableAgentId?: string;

  @ApiPropertyOptional({ description: 'Equipo responsable (referencia blanda)' })
  @IsOptional()
  @IsString()
  equipoId?: string;

  @ApiPropertyOptional({ description: 'Dueño humano (User, referencia blanda)' })
  @IsOptional()
  @IsString()
  duenoUserId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3, description: 'Prioridad (1 = máxima)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  prioridad?: number;

  @ApiPropertyOptional({ description: 'Fecha límite de negocio (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  fechaLimite?: string;

  @ApiPropertyOptional({ enum: TIPOS_RESULTADO, default: 'PRODUCTO_INTERMEDIO' })
  @IsOptional()
  @IsIn(TIPOS_RESULTADO)
  tipoResultado?: TipoResultadoDto;

  @ApiPropertyOptional({ description: 'Tarea padre (cadena de delegación, RF10)' })
  @IsOptional()
  @IsString()
  parentTareaId?: string;

  @ApiPropertyOptional({ description: 'Identificador del hilo de negocio (correlación, RF10)' })
  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class UpdateTareaDto extends PartialType(CreateTareaDto) {}

/** Cambio del estado OPERATIVO de la tarea. COMPLETADA exige ContratoResultado ACEPTADO (se valida en el servicio). */
export class CambiarEstadoTareaDto {
  @ApiProperty({ enum: ESTADOS_TAREA })
  @IsIn(ESTADOS_TAREA)
  estado!: EstadoTareaDto;

  @ApiPropertyOptional({ description: 'Motivo del cambio (auditable)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

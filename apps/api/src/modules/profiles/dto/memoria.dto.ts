import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Estados de gobierno de un hecho de memoria operativa. Debe coincidir con el enum `EstadoMemoria` de Prisma. */
export const ESTADOS_MEMORIA = ['PROPUESTO', 'CONFIRMADO'] as const;
export type EstadoMemoria = (typeof ESTADOS_MEMORIA)[number];

/**
 * Alta de un hecho de memoria operativa (ADR 0018 Inc.1, esquema base). Es CONTEXTO gobernado: nace PROPUESTO y
 * requiere revisión humana para CONFIRMADO; no altera la versión del agente sin revisión (ADR 0004). El
 * `workspaceId` NUNCA llega en el cuerpo: se toma de `@CurrentAuth()`.
 */
export class CreateMemoriaDto {
  @ApiProperty({ description: 'Proceso al que pertenece el hecho (clave de agrupación)' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  procesoClave!: string;

  @ApiProperty({ description: 'Hecho aprendido (texto libre)' })
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  hecho!: string;

  @ApiPropertyOptional({ description: 'Procedencia o evidencia del hecho' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fuente?: string;

  @ApiPropertyOptional({ enum: ESTADOS_MEMORIA, default: 'PROPUESTO', description: 'Estado de gobierno del hecho' })
  @IsOptional()
  @IsIn(ESTADOS_MEMORIA)
  estado?: EstadoMemoria;

  @ApiPropertyOptional({ description: 'Fecha de caducidad en ISO-8601 (null = sin caducidad)' })
  @IsOptional()
  @IsISO8601()
  caducaEn?: string;
}

/** Edición parcial del hecho de memoria operativa; todos los campos opcionales en PATCH. */
export class UpdateMemoriaDto extends PartialType(CreateMemoriaDto) {}

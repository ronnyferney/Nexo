import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Debe coincidir con el enum `TipoCanal` de Prisma. */
export const TIPOS_CANAL = ['MISION', 'PROCESO', 'AREA'] as const;
export type TipoCanalDto = (typeof TIPOS_CANAL)[number];

export class CrearCanalDto {
  @ApiProperty({ enum: TIPOS_CANAL })
  @IsIn(TIPOS_CANAL)
  tipo!: TipoCanalDto;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Empresa / área de alcance (OrgUnit, referencia blanda)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional({ description: 'Objetivo/misión de alcance (referencia blanda)' })
  @IsOptional()
  @IsString()
  misionId?: string;
}

export class CrearHiloDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  asunto!: string;
}

/**
 * Convierte una solicitud de acción de un hilo en una TAREA autorizada (RF36/D5). Mencionar no asigna trabajo ni
 * concede acceso: la tarea se crea aquí solo con EDITOR+ (autoridad), no por una publicación.
 */
export class ConvertirEnTareaDto {
  @ApiProperty({ description: 'Título de la tarea autorizada' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  titulo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  criterioAceptacion?: string;

  @ApiPropertyOptional({ description: 'Responsable digital (referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableAgentId?: string;

  @ApiPropertyOptional({ description: 'Dueño humano (referencia blanda)' })
  @IsOptional()
  @IsString()
  duenoUserId?: string;

  @ApiPropertyOptional({ description: 'Objetivo al que pertenece (referencia blanda)' })
  @IsOptional()
  @IsString()
  objetivoId?: string;
}

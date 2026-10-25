import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Incumplimiento + plan de recuperación (RF31): alerta, responsable, plazo y LÍMITES explícitos de reintentos,
 * gasto y ciclos, con escalamiento al siguiente nivel digital.
 */
export class CrearIncumplimientoDto {
  @ApiProperty({ description: 'Causa del incumplimiento (código o descripción auditable)' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  causa!: string;

  @ApiPropertyOptional({ description: 'Plan de recuperación' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  planRecuperacion?: string;

  @ApiPropertyOptional({ description: 'Responsable humano del plan (User, referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableUserId?: string;

  @ApiPropertyOptional({ description: 'Escalamiento al siguiente nivel digital (Agent, referencia blanda)' })
  @IsOptional()
  @IsString()
  escalaAgentId?: string;

  @ApiPropertyOptional({ description: 'Plazo del plan (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  plazo?: string;

  @ApiPropertyOptional({ default: 0, description: 'Límite de reintentos (0 = sin límite por reintentos)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxReintentos?: number;

  @ApiPropertyOptional({ default: 0, description: 'Límite de ciclos de corrección (0 = sin límite por ciclos)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxCiclos?: number;

  @ApiPropertyOptional({ description: 'Límite de gasto en USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCostoUsd?: number;
}

/** Registra un intento/ciclo de corrección sobre un incumplimiento abierto (cuenta contra los límites, RF31). */
export class RegistrarIntentoDto {
  @ApiPropertyOptional({ default: true, description: 'Si cuenta como un reintento' })
  @IsOptional()
  reintento?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Si cuenta como un ciclo de corrección' })
  @IsOptional()
  ciclo?: boolean;

  @ApiPropertyOptional({ description: 'Nota del intento (auditable)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nota?: string;
}

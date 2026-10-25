import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TIPOS_RESULTADO, type TipoResultadoDto } from './tarea.dto';

/** Debe coincidir con el enum `EstadoResultado` de Prisma (solo transiciones de avance manuales). */
export const ESTADOS_RESULTADO_AVANCE = ['EN_PRODUCCION', 'PENDIENTE_VALIDACION'] as const;
export type EstadoResultadoAvanceDto = (typeof ESTADOS_RESULTADO_AVANCE)[number];

/**
 * Contrato de resultado (RF29). La `reglaValidacion` es declarativa: { combinator?: 'and'|'or', rules: [...] } con el
 * motor de reglas puro del flujo (NUNCA `eval`). `evidenciaExigida` lista los tipos de evidencia obligatorios.
 */
export class CrearContratoDto {
  @ApiProperty({ description: 'Resultado esperado (objeto verificable, no una descripción libre)' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  resultadoEsperado!: string;

  @ApiPropertyOptional({ description: 'Alcance del resultado' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  alcance?: string;

  @ApiPropertyOptional({ description: 'Entradas del contrato' })
  @IsOptional()
  @IsObject()
  entradas?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Responsable digital (Agent, referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableAgentId?: string;

  @ApiPropertyOptional({ description: 'Dueño humano (User, referencia blanda)' })
  @IsOptional()
  @IsString()
  duenoUserId?: string;

  @ApiPropertyOptional({ description: 'Fecha comprometida (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Presupuesto en USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  presupuestoUsd?: number;

  @ApiPropertyOptional({ description: 'Indicador del resultado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  indicador?: string;

  @ApiPropertyOptional({
    description: 'Regla determinista declarativa { combinator?, rules: [{left,operator,right}] }',
  })
  @IsOptional()
  @IsObject()
  reglaValidacion?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Tipos de evidencia obligatorios' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  evidenciaExigida?: string[];

  @ApiPropertyOptional({ enum: TIPOS_RESULTADO, default: 'RESULTADO_NEGOCIO' })
  @IsOptional()
  @IsIn(TIPOS_RESULTADO)
  tipoResultado?: TipoResultadoDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 1, description: 'Nivel de riesgo (1 = bajo)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  nivelRiesgo?: number;
}

/** Edición del contrato: solo mientras está PROPUESTO. Un contrato comprometido es inmutable (nueva versión). */
export class ActualizarContratoDto extends CrearContratoDto {}

export class AvanzarContratoDto {
  @ApiProperty({ enum: ESTADOS_RESULTADO_AVANCE, description: 'Siguiente estado de avance del resultado' })
  @IsIn(ESTADOS_RESULTADO_AVANCE)
  estado!: EstadoResultadoAvanceDto;
}

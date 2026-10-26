import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { ImpactoPotencial } from '../riesgo.rules';

export const NIVELES_RIESGO = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO', 'DESCONOCIDO'] as const;
export type NivelRiesgoDto = (typeof NIVELES_RIESGO)[number];

export const IMPACTOS = ['NINGUNO', 'BAJO', 'MEDIO', 'ALTO', 'CRITICO'] as const;

// ---------- Catálogo de acciones sensibles ----------

/** Alta de un tipo de acción sensible configurado por la empresa (ADMIN). */
export class CreateTipoAccionSensibleDto {
  @ApiProperty({ description: 'Código del tipo de acción (= tipoAccion): PAGO, EMAIL_SEND, VOICE_CALL...' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  codigo!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Empresa (OrgUnit EMPRESA) a la que aplica; vacío = todo el workspace' })
  @IsOptional()
  @IsString()
  empresaId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiereAprobacion?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiereDobleAprobacion?: boolean;

  @ApiPropertyOptional({ enum: NIVELES_RIESGO, default: 'DESCONOCIDO' })
  @IsOptional()
  @IsIn(NIVELES_RIESGO)
  nivelRiesgoPorDefecto?: NivelRiesgoDto;

  @ApiPropertyOptional({ description: 'Umbral de monto (lo fija Finanzas; vacío por defecto)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  umbralMonto?: number;

  @ApiPropertyOptional({ description: 'Moneda del umbral/límite (la fija Finanzas; vacía por defecto)' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  moneda?: string;

  @ApiPropertyOptional({ description: 'Límite acumulado por periodo (lo fija Finanzas; vacío por defecto)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  limiteAcumuladoPeriodo?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/**
 * Cambio de banderas/umbrales/riesgo de un tipo de acción sensible (ADMIN). El `codigo` NO se cambia aquí: en las
 * entradas de sistema es inmutable y, en general, identifica el tipo de acción; para otro código, créese una entrada.
 */
export class UpdateTipoAccionSensibleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiereAprobacion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiereDobleAprobacion?: boolean;

  @ApiPropertyOptional({ enum: NIVELES_RIESGO })
  @IsOptional()
  @IsIn(NIVELES_RIESGO)
  nivelRiesgoPorDefecto?: NivelRiesgoDto;

  @ApiPropertyOptional({ description: 'Umbral de monto (lo fija Finanzas). Enviar null para limpiarlo.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  umbralMonto?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  moneda?: string | null;

  @ApiPropertyOptional({ description: 'Límite acumulado por periodo (lo fija Finanzas). Enviar null para limpiarlo.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  limiteAcumuladoPeriodo?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/** Filtro del catálogo efectivo. */
export class ListTiposAccionSensibleQueryDto {
  @ApiPropertyOptional({ description: 'Resolver el catálogo efectivo para esta empresa (hereda las de workspace)' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}

// ---------- Clasificación de riesgo ----------

/** Entrada de la clasificación de prueba. Solo hechos estructurados; NO se acepta "consenso de modelos". */
export class ClasificarRiesgoDto {
  @ApiPropertyOptional({
    description: 'Tipo de acción (codigo) para tomar su nivel por defecto del catálogo como piso',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tipoAccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  empresaId?: string;

  @ApiPropertyOptional({
    enum: NIVELES_RIESGO,
    description: 'Nivel por defecto explícito (si no se resuelve por catálogo)',
  })
  @IsOptional()
  @IsIn(NIVELES_RIESGO)
  nivelPorDefecto?: NivelRiesgoDto;

  @ApiPropertyOptional({ description: 'Hay evidencia suficiente para decidir (debe afirmarse explícitamente)' })
  @IsOptional()
  @IsBoolean()
  evidenciaSuficiente?: boolean;

  @ApiPropertyOptional({ description: 'Las señales/fuentes se contradicen entre sí' })
  @IsOptional()
  @IsBoolean()
  señalesContradictorias?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reversible?: boolean;

  @ApiPropertyOptional({ enum: IMPACTOS })
  @IsOptional()
  @IsIn(IMPACTOS)
  impactoPotencial?: ImpactoPotencial;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  afectaProduccion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  datosSensibles?: boolean;

  @ApiPropertyOptional({ description: 'Las reglas de negocio que habilitan la automatización se cumplen' })
  @IsOptional()
  @IsBoolean()
  cumpleReglas?: boolean;
}

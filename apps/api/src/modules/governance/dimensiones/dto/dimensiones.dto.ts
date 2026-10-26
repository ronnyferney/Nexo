import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { DimensionTipoValor, EstadoEstructura } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// ============================ Dimensión (ADR 0011 D8) ============================

export class CreateDimensionDto {
  @ApiProperty({ description: 'Código único por (workspace, empresa). Estable; se usa como clave del snapshot.' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  codigo!: string;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) nombre!: string;

  @ApiPropertyOptional({ description: 'Empresa (OrgUnit EMPRESA). null = aplica a toda la organización.' })
  @IsOptional()
  @IsString()
  empresaId?: string | null;

  @ApiPropertyOptional({ enum: DimensionTipoValor })
  @IsOptional()
  @IsEnum(DimensionTipoValor)
  tipoValor?: DimensionTipoValor;

  @ApiPropertyOptional({ description: 'Si tipoValor=REFERENCIA: "LineaNegocio" | "Sede" | "CentroCosto" | "OrgUnit"' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  referenciaEntidad?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() jerarquica?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() obligatoria?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() obligatoriaParaEfectoEconomico?: boolean;

  @ApiPropertyOptional({ type: [String], description: '"ejecucion" | "tarea" | "costo" | "agente" | ...' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(32)
  aplicaA?: string[];

  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** El código y la empresa fijan el ámbito de unicidad y del snapshot: no se cambian tras crear la dimensión. */
export class UpdateDimensionDto extends PartialType(
  OmitType(CreateDimensionDto, ['codigo', 'empresaId', 'tipoValor', 'referenciaEntidad'] as const),
) {}

// ============================ Valor de dimensión (ADR 0011 D8) ============================

export class CreateDimensionValueDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) codigo!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) nombre!: string;
  @ApiPropertyOptional({ description: 'Padre para la jerarquía (roll-up). Sin ciclos.' })
  @IsOptional()
  @IsString()
  padreId?: string | null;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

export class UpdateDimensionValueDto extends PartialType(OmitType(CreateDimensionValueDto, ['codigo'] as const)) {}

// ============================ Etiquetado (ADR 0011 D8) ============================

export class CreateDimensionAssignmentDto {
  @ApiProperty({ description: '"ejecucion" | "tarea" | "costo" | "orgUnit" | "lineaNegocio" | "agente" | ...' })
  @IsString()
  @MaxLength(60)
  targetType!: string;

  @ApiProperty() @IsString() @MaxLength(191) targetId!: string;

  @ApiPropertyOptional({
    description: 'Para LISTA: id del DimensionValue. Para REFERENCIA: id de la entidad referida.',
  })
  @IsOptional()
  @IsString()
  dimensionValueId?: string | null;

  @ApiPropertyOptional({ description: 'Para TEXTO/NUMERO: valor literal.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  valorLiteral?: string | null;
}

// ============================ Consola de análisis (ADR 0011 D7/D8) ============================

export class AnalisisQueryDto {
  @ApiProperty({ description: 'Código de la dimensión por la que se pivota el consumo.' })
  @IsString()
  @MaxLength(60)
  groupBy!: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class DimensionesQueryDto {
  @ApiPropertyOptional({ description: 'Acota el listado a una empresa (OrgUnit EMPRESA).' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}

/**
 * Comprobación de integridad de dimensiones obligatorias al despachar trabajo con efecto económico (ADR 0011 D8,
 * integridad a). Pensada para que E4/E6 la invoquen antes de registrar el hecho económico: si falta el valor de una
 * dimensión `obligatoriaParaEfectoEconomico`, bloquea.
 */
export class ValidarEfectoEconomicoDto {
  @ApiProperty({ description: 'Tipo de entidad etiquetable ("ejecucion" | "tarea" | "costo" ...).' })
  @IsString()
  @MaxLength(60)
  aplicaA!: string;

  @ApiPropertyOptional({ description: 'Empresa del hecho económico (OrgUnit EMPRESA).' })
  @IsOptional()
  @IsString()
  empresaId?: string | null;

  @ApiProperty({ type: Object, description: 'Snapshot { dimensionCodigo: valor } del trabajo a despachar.' })
  @IsObject()
  dimensiones!: Record<string, unknown>;
}

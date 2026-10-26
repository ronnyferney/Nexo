import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { EstadoEstructura } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// ============================ Servicio interno / compartido (RF44) ============================

export class CreateServicioInternoDto {
  @ApiProperty({ description: 'OrgUnit EMPRESA dueña del servicio' }) @IsString() empresaId!: string;
  @ApiProperty({ description: 'OrgUnit que presta el servicio (área dueña)' }) @IsString() areaDuenoId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) codigo!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) nombre!: string;
  @ApiPropertyOptional({ description: 'Responsable humano (no concede acceso, D6)' })
  @IsOptional()
  @IsString()
  responsableUserId?: string | null;
  @ApiPropertyOptional({ description: 'Responsable digital (agente)' })
  @IsOptional()
  @IsString()
  responsableAgentId?: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Acuerdo de servicio: entradas, salidas, criterios' })
  @IsOptional()
  @IsObject()
  acuerdoServicio?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [Object], description: 'Clientes internos [{ tipo, id, nombre }]' })
  @IsOptional()
  @IsArray()
  clientesInternos?: unknown[];
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** La empresa de un servicio no se cambia tras crearlo (altera el ámbito de unicidad del código). */
export class UpdateServicioInternoDto extends PartialType(OmitType(CreateServicioInternoDto, ['empresaId'] as const)) {}

// ============================ Reparto de costo del servicio (RF45) ============================

/** Una fila del reparto: exactamente un destino (línea/área/centro de costo) con su porcentaje. */
export class DestinoImputacionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() lineaNegocioId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() orgUnitId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() centroCostoId?: string | null;
  @ApiProperty({ description: 'Porcentaje del reparto (0 < x ≤ 100); la suma por servicio+periodo debe ser 100' })
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentaje!: number;
}

/** Define el reparto COMPLETO de un servicio para un periodo (reemplaza el anterior de ese periodo, atómico). */
export class SetRepartoDto {
  @ApiProperty({ description: 'Clave de periodo coherente con BudgetLedger (p. ej. "2026-M10")' })
  @IsString()
  @MaxLength(20)
  periodoKey!: string;
  @ApiProperty({ type: [DestinoImputacionDto], description: 'Destinos del reparto; deben sumar 100 % sin repetidos' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DestinoImputacionDto)
  destinos!: DestinoImputacionDto[];
}

// ============================ Consultas ============================

export class ServiciosQueryDto {
  @ApiPropertyOptional({ description: 'Acota el listado a una empresa (OrgUnit EMPRESA)' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}

export class RepartoQueryDto {
  @ApiPropertyOptional({ description: 'Periodo a consultar (si se omite, devuelve todos los periodos del servicio)' })
  @IsOptional()
  @IsString()
  periodoKey?: string;
}

/** Dimensión por la que consolida el costo medido (ADR 0011 D7/RF47 parcial). */
export type DimensionConsolidacion = 'empresa' | 'linea' | 'area' | 'centro';

export class ConsolidacionQueryDto {
  @ApiProperty({ enum: ['empresa', 'linea', 'area', 'centro'], description: 'Dimensión de consolidación' })
  @IsEnum(['empresa', 'linea', 'area', 'centro'])
  dimension!: DimensionConsolidacion;
  @ApiPropertyOptional({ description: 'Inicio del rango (ISO). Por defecto, inicio del mes en curso.' })
  @IsOptional()
  @IsISO8601()
  from?: string;
  @ApiPropertyOptional({ description: 'Fin del rango (ISO). Por defecto, ahora.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
  @ApiPropertyOptional({ description: 'Acota la consolidación a una empresa (OrgUnit EMPRESA)' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}

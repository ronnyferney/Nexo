import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { EstadoEstructura, TipoAsignacion } from '@prisma/client';
import { IsEnum, IsISO8601, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// ============================ Línea de negocio (ADR 0011 D3) ============================

export class CreateLineaNegocioDto {
  @ApiProperty({ description: 'OrgUnit EMPRESA dueña de la línea' }) @IsString() empresaId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) codigo!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) nombre!: string;
  @ApiPropertyOptional({ description: 'Responsable humano (no concede acceso, D6)' })
  @IsOptional()
  @IsString()
  responsableUserId?: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Metas/objetivos; no reemplaza el sistema de origen' })
  @IsOptional()
  @IsObject()
  metas?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** La empresa de una línea no se cambia tras crearla (altera el ámbito de unicidad del código). */
export class UpdateLineaNegocioDto extends PartialType(OmitType(CreateLineaNegocioDto, ['empresaId'] as const)) {}

// ============================ Sede (ADR 0011 D3) ============================

export class CreateSedeDto {
  @ApiProperty({ description: 'OrgUnit EMPRESA dueña de la sede' }) @IsString() empresaId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) codigo!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) nombre!: string;
  @ApiProperty({ description: 'Zona horaria IANA, p. ej. "America/Bogota"' })
  @IsString()
  @MaxLength(80)
  zonaHoraria!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) alcanceTerritorial?: string | null;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

export class UpdateSedeDto extends PartialType(OmitType(CreateSedeDto, ['empresaId'] as const)) {}

// ============================ Centro de costo (ADR 0011 D3/D5) ============================

export class CreateCentroCostoDto {
  @ApiProperty({ description: 'OrgUnit EMPRESA dueña del centro de costo' }) @IsString() empresaId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) codigo!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) nombre!: string;
  @ApiPropertyOptional({ description: 'Asociación por defecto opcional (no concede permisos)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() lineaNegocioId?: string | null;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

export class UpdateCentroCostoDto extends PartialType(OmitType(CreateCentroCostoDto, ['empresaId'] as const)) {}

// ============================ Asignación organizacional (ADR 0011 D4) ============================

export class CreateAsignacionDto {
  @ApiPropertyOptional({ description: 'Sujeto agente (exactamente uno de agentId/userId)' })
  @IsOptional()
  @IsString()
  agentId?: string | null;
  @ApiPropertyOptional({ description: 'Sujeto miembro (exactamente uno de agentId/userId)' })
  @IsOptional()
  @IsString()
  userId?: string | null;
  @ApiProperty({ enum: TipoAsignacion }) @IsEnum(TipoAsignacion) tipoAsignacion!: TipoAsignacion;
  @ApiPropertyOptional() @IsOptional() @IsString() orgUnitId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() lineaNegocioId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() sedeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() proyectoId?: string | null;
  @ApiPropertyOptional({ description: 'colaborador | revisor | responsable_proceso ...' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  rol?: string | null;
  @ApiPropertyOptional({ type: Object, description: 'Qué habilita OPERATIVAMENTE; nunca acceso a datos (D6)' })
  @IsOptional()
  @IsObject()
  alcance?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** En una asignación solo se editan rol, alcance, estado y la vigencia (cerrar/reabrir); no el sujeto ni el destino. */
export class UpdateAsignacionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) rol?: string | null;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() alcance?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** Filtro de listado por empresa (aislamiento ADR 0011 D1). */
export class EstructuraQueryDto {
  @ApiPropertyOptional({ description: 'Acota el listado a una empresa (OrgUnit EMPRESA)' })
  @IsOptional()
  @IsString()
  empresaId?: string;
}

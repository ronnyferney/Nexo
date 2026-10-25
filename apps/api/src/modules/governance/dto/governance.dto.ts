import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetPeriod, BudgetPolicy, EstadoEstructura, OrgUnitTipo, Role } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrgUnitDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string;
  @ApiProperty() @IsString() parentId!: string;
  /** Dimensión jerárquica/funcional (ADR 0011 D2). Por defecto AREA_FUNCIONAL (retrocompatible). */
  @ApiPropertyOptional({ enum: OrgUnitTipo }) @IsOptional() @IsEnum(OrgUnitTipo) tipo?: OrgUnitTipo;
  /** Empresa (OrgUnit EMPRESA) a la que pertenece la unidad. Se valida que exista y sea EMPRESA del workspace. */
  @ApiPropertyOptional() @IsOptional() @IsString() empresaId?: string | null;
  /** Responsable humano de la unidad (RF43). No concede acceso (D6). */
  @ApiPropertyOptional() @IsOptional() @IsString() responsableUserId?: string | null;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

export class UpdateOrgUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) code?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional({ type: [String], description: '"<providerId>:<modelId>"; vacío = hereda' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  allowedModels?: string[];
  @ApiPropertyOptional({ enum: OrgUnitTipo }) @IsOptional() @IsEnum(OrgUnitTipo) tipo?: OrgUnitTipo;
  @ApiPropertyOptional() @IsOptional() @IsString() empresaId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() responsableUserId?: string | null;
  @ApiPropertyOptional({ enum: EstadoEstructura }) @IsOptional() @IsEnum(EstadoEstructura) estado?: EstadoEstructura;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteDesde?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() vigenteHasta?: string | null;
}

/** Invitación a un miembro (C1): la cuenta y la contraseña las crea la persona al aceptar. */
export class AddMemberDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional({ description: 'Nombre sugerido (la persona puede cambiarlo al aceptar)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
  @ApiProperty({ enum: Role }) @IsEnum(Role) role!: Role;
  @ApiPropertyOptional() @IsOptional() @IsString() orgUnitId?: string;
}

export class AcceptInvitationDto {
  @ApiPropertyOptional({ description: 'Obligatorio si la cuenta no existe' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
  @ApiPropertyOptional({ description: 'Obligatoria si la cuenta no existe o no tiene el correo verificado' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: Role }) @IsOptional() @IsEnum(Role) role?: Role;
  @ApiPropertyOptional() @IsOptional() @IsString() orgUnitId?: string;
}

export class UpsertBudgetDto {
  @ApiProperty({ enum: BudgetPeriod }) @IsEnum(BudgetPeriod) period!: BudgetPeriod;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 8 }) @Min(0) @Max(100_000_000) limitUsd!: number;
  @ApiProperty({ enum: BudgetPolicy }) @IsEnum(BudgetPolicy) policy!: BudgetPolicy;
  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(1000, { each: true })
  alertThresholds?: number[];
  @ApiPropertyOptional() @IsOptional() @IsString() downgradeProviderId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() downgradeModel?: string | null;
}

export const GROUP_BY = ['orgUnit', 'model', 'agent', 'user', 'day', 'role', 'routingReason'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export class UsageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: GROUP_BY }) @IsOptional() @IsIn(GROUP_BY) groupBy?: GroupBy;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetPeriod, BudgetPolicy, EstadoEstructura, OrgUnitTipo, Role } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  @ApiPropertyOptional({ type: [Number], description: 'Umbrales de alerta en %, por defecto 80/90/100' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(1000, { each: true })
  alertThresholds?: number[];
  @ApiPropertyOptional() @IsOptional() @IsString() downgradeProviderId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() downgradeModel?: string | null;
  /** Criticidad del proceso (P1.1c). Por defecto crítico: al tope BLOQUEA; la degradación solo se habilita si es no
   * crítico (`false`) y además se registró la validación de impacto. */
  @ApiPropertyOptional({ description: 'Proceso crítico (default true): un crítico bloquea al tope, no degrada' })
  @IsOptional()
  @IsBoolean()
  critico?: boolean;
}

/** Bolsa por agente (P0.1 nivel agente): mismos campos que la de unidad; el agente se indica en la ruta. */
export class UpsertAgentBudgetDto extends UpsertBudgetDto {}

/** Registro de validación de impacto de la degradación (P1.1c). */
export class ValidarImpactoDto {
  @ApiPropertyOptional({ description: 'Nota de la validación de impacto (evidencia/alcance)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nota?: string;
}

/** Autorización expresa para gastar por encima del tope (P0.1). Alcance: una unidad O un agente (no ambos). */
export class GrantBudgetOverrideDto {
  @ApiPropertyOptional({ description: 'Unidad a autorizar (exclusivo con agentId)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;
  @ApiPropertyOptional({ description: 'Agente a autorizar (exclusivo con orgUnitId)' })
  @IsOptional()
  @IsString()
  agentId?: string;
  @ApiProperty({ description: 'Motivo de la autorización (auditado)' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
  @ApiProperty({ description: 'Vigencia (ISO 8601); debe ser futura. Acota el alcance temporal de la autorización.' })
  @IsISO8601()
  expiresAt!: string;
  @ApiPropertyOptional({ description: 'Tope adicional de gasto en USD sobre el límite (alcance de gasto acotado)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  @Max(100_000_000)
  limitExtraUsd?: number;
}

/** Preset de piloto US$ 0 (P0.1b): con `modoPiloto` solo se permite el proveedor mock. */
export class SetPilotDto {
  @ApiProperty() @IsBoolean() modoPiloto!: boolean;
}

export const GROUP_BY = ['orgUnit', 'model', 'agent', 'user', 'day', 'role', 'routingReason'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export class UsageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: GROUP_BY }) @IsOptional() @IsIn(GROUP_BY) groupBy?: GroupBy;
}

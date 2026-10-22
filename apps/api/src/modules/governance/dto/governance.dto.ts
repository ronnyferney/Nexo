import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetPeriod, BudgetPolicy, Role } from '@prisma/client';
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
}

export class AddMemberDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty({ enum: Role }) @IsEnum(Role) role!: Role;
  @ApiPropertyOptional() @IsOptional() @IsString() orgUnitId?: string;
  @ApiPropertyOptional({ description: 'Obligatoria si el usuario no existe' })
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
  @ApiProperty() @IsNumber() @Min(0) @Max(100_000_000) limitUsd!: number;
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

export const GROUP_BY = ['orgUnit', 'model', 'agent', 'user', 'day'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export class UsageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ enum: GROUP_BY }) @IsOptional() @IsIn(GROUP_BY) groupBy?: GroupBy;
}

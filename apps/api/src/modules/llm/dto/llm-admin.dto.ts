import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { LlmKind, ModelTier } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateLlmConnectionDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty({ enum: LlmKind }) @IsEnum(LlmKind) kind!: LlmKind;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false }) baseUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) apiKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateLlmConnectionDto extends PartialType(CreateLlmConnectionDto) {}

export class CreateLlmModelDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) modelId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @ApiProperty({ enum: ModelTier }) @IsEnum(ModelTier) tier!: ModelTier;
  @ApiProperty() @IsNumber() @Min(0) @Max(10_000) inputUsdPerMTok!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(10_000) outputUsdPerMTok!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(10_000) cacheReadUsdPerMTok?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateLlmModelDto extends PartialType(CreateLlmModelDto) {}

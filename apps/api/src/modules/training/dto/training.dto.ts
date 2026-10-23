import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const FEEDBACK_RATINGS = ['UP', 'DOWN'] as const;
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'DISCARDED'] as const;
export const REVIEW_ACTIONS = ['APPROVE', 'DISCARD'] as const;

export class CreateFeedbackDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) conversationId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100_000) userMessage!: string;
  @ApiProperty() @IsString() @MaxLength(200_000) agentResponse!: string;
  @ApiProperty({ enum: FEEDBACK_RATINGS }) @IsIn(FEEDBACK_RATINGS) rating!: (typeof FEEDBACK_RATINGS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) comment?: string;
  @ApiPropertyOptional({ description: 'Respuesta corregida propuesta por el usuario' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  correction?: string;
}

export class FeedbackQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_STATUSES })
  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: (typeof REVIEW_STATUSES)[number];
}

export class ReviewFeedbackDto {
  @ApiProperty({ enum: REVIEW_ACTIONS }) @IsIn(REVIEW_ACTIONS) action!: (typeof REVIEW_ACTIONS)[number];
  @ApiPropertyOptional({ description: 'Corrección final del supervisor (reemplaza la del usuario)' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  correction?: string;
  @ApiPropertyOptional({ description: 'Además del ejemplo, crear un caso de evaluación' })
  @IsOptional()
  @IsBoolean()
  addAsEvalCase?: boolean;
}

export class CreateEvalCaseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20_000) input!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20_000) expected?: string;
  @ApiPropertyOptional({ description: 'Rúbrica en texto' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  criteria?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

export class UpdateEvalCaseDto extends PartialType(CreateEvalCaseDto) {}

export class CreateEvalRunDto {
  @ApiProperty({ description: 'Proveedor del juez (del catálogo)' }) @IsString() @MinLength(1) judgeProviderId!: string;
  @ApiProperty({ description: 'Modelo del juez (del catálogo)' }) @IsString() @MinLength(1) judgeModel!: string;
  @ApiPropertyOptional({ default: 0.7 }) @IsOptional() @IsNumber() @Min(0) @Max(1) passThreshold?: number;
  @ApiPropertyOptional({ description: 'Nota de la versión que se crea si la configuración cambió' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  versionNote?: string;
}

export class ReviewEvalResultDto {
  @ApiProperty({ nullable: true, description: 'Puntaje humano 0..1; null lo elimina' })
  @ValidateIf((o: ReviewEvalResultDto) => o.humanScore !== null)
  @IsNumber()
  @Min(0)
  @Max(1)
  humanScore!: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) humanNote?: string;
}

export class CreateVersionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateSuggestionDto {
  @ApiProperty() @IsString() @MinLength(1) providerId!: string;
  @ApiProperty() @IsString() @MinLength(1) model!: string;
}

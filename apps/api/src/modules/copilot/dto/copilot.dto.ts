import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const COPILOT_MODES = ['CREATE', 'IMPROVE', 'DIAGNOSE'] as const;
export const RATINGS = ['UP', 'DOWN'] as const;

export class CreateCopilotSessionDto {
  @ApiProperty({ enum: COPILOT_MODES }) @IsIn(COPILOT_MODES) mode!: (typeof COPILOT_MODES)[number];
  @ApiPropertyOptional({ description: 'Obligatorio en IMPROVE y DIAGNOSE' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentId?: string;
  @ApiPropertyOptional({ description: 'Contexto inicial (plantilla de industria, pantalla de origen...)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  context?: string;
}

export class CopilotMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20_000) message!: string;
  @ApiPropertyOptional({ description: 'Responder como text/event-stream' })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class CopilotFeedbackDto {
  @ApiProperty({ enum: RATINGS }) @IsIn(RATINGS) rating!: (typeof RATINGS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @ApiPropertyOptional({ description: 'Compartir la conversación con Nexo para mejorar el Copilot' })
  @IsOptional()
  @IsBoolean()
  shareConversation?: boolean;
}

export class PlatformRangeDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
}

export class PlatformFeedbackQueryDto {
  @ApiPropertyOptional({ enum: RATINGS }) @IsOptional() @IsIn(RATINGS) rating?: (typeof RATINGS)[number];
  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

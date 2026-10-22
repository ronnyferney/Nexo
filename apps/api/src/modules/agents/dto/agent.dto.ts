import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export class CreateAgentDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ default: 'anthropic' }) @IsOptional() @IsString() provider?: string;
  @ApiPropertyOptional({ default: 'claude-opus-5-5' }) @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50_000) systemPrompt?: string;
  @ApiPropertyOptional({ enum: EFFORTS }) @IsOptional() @IsIn(EFFORTS) effort?: (typeof EFFORTS)[number];
  @ApiPropertyOptional({ default: 12 }) @IsOptional() @IsInt() @Min(1) @Max(50) maxTurns?: number;
}

export class UpdateAgentDto extends PartialType(CreateAgentDto) {}

export class AgentToolBindingDto {
  @ApiProperty() @IsString() operationId!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresApproval?: boolean;
}

export class SetAgentToolsDto {
  @ApiProperty({ type: [AgentToolBindingDto] })
  @IsArray()
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => AgentToolBindingDto)
  tools!: AgentToolBindingDto[];
}

export class ChatDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100_000) message!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
  @ApiPropertyOptional({ description: 'Tools que requieren aprobación y el usuario autorizó para este turno' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  approvedTools?: string[];
  @ApiPropertyOptional({ description: 'Responder como text/event-stream' })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

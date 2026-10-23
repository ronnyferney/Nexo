import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SHARE_PRINCIPAL_TYPES, type SharePrincipalType } from '../../agent-access/share-principals.service';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Perfil estructurado (ADR 0003, D2). Todos los campos son opcionales. */
export class AgentProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) role?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  goals?: string[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  responsibilities?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Lo que el agente NO debe hacer' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  boundaries?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) tone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) outputFormat?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) language?: string;
}

/** `"<providerId>:<modelId>"`; el modelo puede contener ":" (p. ej. `ollama:llama3:8b`). */
export const MODEL_REF = /^[A-Za-z0-9_-]{1,64}:\S{1,128}$/;

export class CreateAgentDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ default: 'anthropic' }) @IsOptional() @IsString() provider?: string;
  @ApiPropertyOptional({ default: 'claude-opus-5-5' }) @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50_000) systemPrompt?: string;
  @ApiPropertyOptional({ enum: EFFORTS }) @IsOptional() @IsIn(EFFORTS) effort?: (typeof EFFORTS)[number];
  @ApiPropertyOptional({ default: 12 }) @IsOptional() @IsInt() @Min(1) @Max(50) maxTurns?: number;
  @ApiPropertyOptional({ description: 'Unidad a la que se imputa el consumo sin usuario (flujos, MCP)' })
  @IsOptional()
  @IsString()
  costCenterId?: string | null;
  @ApiPropertyOptional({ type: AgentProfileDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentProfileDto)
  profile?: AgentProfileDto;
  @ApiPropertyOptional({ type: [String], description: 'Cadena de respaldo "<providerId>:<modelId>" (máx. 3)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @Matches(MODEL_REF, { each: true, message: 'Cada respaldo debe tener el formato "<providerId>:<modelId>"' })
  fallbackModels?: string[];
  @ApiPropertyOptional({ default: 0.85, description: 'Meta de puntaje de evaluación 0..1 (ADR 0004)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  targetScore?: number;
  @ApiPropertyOptional({
    enum: ['PRIVATE', 'TEAM'],
    default: 'PRIVATE',
    description: 'Visibilidad inicial (ADR 0007). TEAM requiere EDITOR+; WORKSPACE exige lanzar el agente primero.',
  })
  @IsOptional()
  @IsIn(['PRIVATE', 'TEAM'])
  visibility?: 'PRIVATE' | 'TEAM';
}

/** La visibilidad, el dueño y el lanzamiento tienen rutas propias: no se editan con PATCH /agents/:id. */
export class UpdateAgentDto extends PartialType(OmitType(CreateAgentDto, ['visibility'] as const)) {}

export const AGENT_SCOPES = ['mine', 'shared', 'workspace', 'all'] as const;

export class ListAgentsQueryDto {
  @ApiPropertyOptional({ enum: AGENT_SCOPES, description: 'Por defecto: todos los agentes que el usuario puede usar' })
  @IsOptional()
  @IsIn(AGENT_SCOPES)
  scope?: (typeof AGENT_SCOPES)[number];
}

export class SetVisibilityDto {
  @ApiProperty({ enum: ['PRIVATE', 'TEAM', 'WORKSPACE'] })
  @IsIn(['PRIVATE', 'TEAM', 'WORKSPACE'])
  visibility!: 'PRIVATE' | 'TEAM' | 'WORKSPACE';
}

export class AgentShareDto {
  @ApiProperty({ enum: SHARE_PRINCIPAL_TYPES, description: 'Usuario, unidad (y subunidades) o grupo de usuarios' })
  @IsIn(SHARE_PRINCIPAL_TYPES)
  principalType!: SharePrincipalType;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) principalId!: string;
  @ApiProperty({ enum: ['USE', 'EDIT'] }) @IsIn(['USE', 'EDIT']) permission!: 'USE' | 'EDIT';
}

export class SetSharesDto {
  @ApiProperty({ type: [AgentShareDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AgentShareDto)
  shares!: AgentShareDto[];
}

export class TransferAgentDto {
  @ApiProperty({ description: 'Usuario (miembro del workspace) que será el nuevo dueño' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  userId!: string;
}

export class DuplicateAgentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
}

export class LaunchAgentDto {
  @ApiPropertyOptional({ description: 'Forzar el lanzamiento sin cumplir los requisitos (solo ADMIN/OWNER)' })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
  @ApiPropertyOptional({ description: 'Razón del override (obligatoria si override = true)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

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

export class SetAgentSkillsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) skillIds!: string[];
}

export class SetAgentKnowledgeDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  knowledgeBaseIds!: string[];
}

export class CreateAgentExampleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) input!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) output!: string;
}

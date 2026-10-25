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
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
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

/** Política de enrutamiento multi-modelo (ADR 0010 D2). JSON validado; nunca `eval`. */
export const ROUTING_OBJECTIVES = ['cost', 'quality', 'balanced'] as const;
export const ROUTING_SPECIALTIES = ['CODE', 'REASONING', 'VISION', 'FAST', 'GENERAL'] as const;
export const ROUTING_TIERS = ['PREMIUM', 'STANDARD', 'ECONOMY'] as const;

/** Condición de una regla: la primera cuyo `when` encaja gana. `when` vacío aplica siempre. */
export class RoutingRuleWhenDto {
  @ApiPropertyOptional({ enum: ROUTING_SPECIALTIES })
  @IsOptional()
  @IsIn(ROUTING_SPECIALTIES)
  capability?: (typeof ROUTING_SPECIALTIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() hasImages?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) minContextTokens?: number;
}

/** Preferencia que una regla empuja al frente. */
export class RoutingRulePreferDto {
  @ApiPropertyOptional({ enum: ROUTING_SPECIALTIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(ROUTING_SPECIALTIES, { each: true })
  specialties?: (typeof ROUTING_SPECIALTIES)[number][];
  @ApiPropertyOptional({ enum: ROUTING_TIERS })
  @IsOptional()
  @IsIn(ROUTING_TIERS)
  tier?: (typeof ROUTING_TIERS)[number];
  @ApiPropertyOptional({ type: [String], description: 'Referencias "<providerId>:<modelId>" preferidas' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(MODEL_REF, { each: true, message: 'Cada modelo debe tener el formato "<providerId>:<modelId>"' })
  models?: string[];
}

export class RoutingRuleDto {
  @ApiProperty({ type: RoutingRuleWhenDto })
  @ValidateNested()
  @Type(() => RoutingRuleWhenDto)
  when!: RoutingRuleWhenDto;
  @ApiProperty({ type: RoutingRulePreferDto })
  @ValidateNested()
  @Type(() => RoutingRulePreferDto)
  prefer!: RoutingRulePreferDto;
}

/** Política de veredicto ante un problema del verificador (ADR 0010 D4, decisión 6). */
export const VERIFY_ISSUE_POLICIES = ['auto', 'warn', 'require_human'] as const;

/**
 * Verificación cruzada redactor+verificador (ADR 0010 D4, fase 3). Opt-in y premium: al menos duplica costo/latencia.
 * El verificador se elige con las reglas de D2/D3; se puede exigir otro `providerId` para reducir sesgos correlacionados.
 */
export class RoutingVerifyDto {
  @ApiProperty({ description: 'Activa la verificación cruzada (opt-in, premium)' })
  @IsBoolean()
  enabled!: boolean;
  @ApiPropertyOptional({ description: 'Verificador explícito "<providerId>:<modelId>"; si falta, se elige por reglas' })
  @IsOptional()
  @IsString()
  @Matches(MODEL_REF, { message: 'El verificador debe tener el formato "<providerId>:<modelId>"' })
  model?: string;
  @ApiPropertyOptional({ description: 'Exigir un verificador de distinto proveedor que el redactor' })
  @IsOptional()
  @IsBoolean()
  requireDifferentProvider?: boolean;
  @ApiPropertyOptional({ enum: VERIFY_ISSUE_POLICIES, description: 'Veredicto ante un problema (por defecto auto)' })
  @IsOptional()
  @IsIn(VERIFY_ISSUE_POLICIES)
  onIssue?: (typeof VERIFY_ISSUE_POLICIES)[number];
}

export class RoutingPolicyDto {
  @ApiProperty({ enum: ROUTING_OBJECTIVES, description: 'Cómo desempatar entre candidatos válidos' })
  @IsIn(ROUTING_OBJECTIVES)
  objective!: (typeof ROUTING_OBJECTIVES)[number];
  @ApiPropertyOptional({ type: [RoutingRuleDto], description: 'Reglas de preferencia en orden de prioridad' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RoutingRuleDto)
  rules?: RoutingRuleDto[];
  @ApiPropertyOptional({ description: 'Tope de intentos totales por tarea (por defecto 3)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxCandidates?: number;
  @ApiPropertyOptional({
    type: RoutingVerifyDto,
    description: 'Verificación cruzada redactor+verificador (ADR 0010 D4)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoutingVerifyDto)
  verify?: RoutingVerifyDto;
}

export class CreateAgentDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Nombre de un ícono del design system (p. ej. "inbox"); null = sin ícono',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'El ícono solo puede contener letras y números, sin espacios' })
  icon?: string | null;
  @ApiPropertyOptional({ default: 'anthropic' }) @IsOptional() @IsString() provider?: string;
  @ApiPropertyOptional({ default: 'claude-opus-5-5' }) @IsOptional() @IsString() model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50_000) systemPrompt?: string;
  @ApiPropertyOptional({ enum: EFFORTS }) @IsOptional() @IsIn(EFFORTS) effort?: (typeof EFFORTS)[number];
  @ApiPropertyOptional({ default: 12 }) @IsOptional() @IsInt() @Min(1) @Max(50) maxTurns?: number;
  @ApiPropertyOptional({ description: 'Unidad a la que se imputa el consumo sin usuario (flujos, MCP)' })
  @IsOptional()
  @IsString()
  costCenterId?: string | null;
  @ApiPropertyOptional({ description: 'Cargo del catálogo que desempeña el empleado digital (RF03/RF04)' })
  @IsOptional()
  @IsString()
  cargoId?: string | null;
  @ApiPropertyOptional({
    description: 'Responsable humano titular del agente (RF02). Obligatorio para publicar (RF06)',
  })
  @IsOptional()
  @IsString()
  responsableUserId?: string | null;
  @ApiPropertyOptional({ description: 'Responsable humano suplente del agente (RF02)' })
  @IsOptional()
  @IsString()
  suplenteUserId?: string | null;
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
  @ApiPropertyOptional({
    type: RoutingPolicyDto,
    nullable: true,
    description: 'Política de enrutamiento multi-modelo (ADR 0010). null = principal + fallbackModels.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => RoutingPolicyDto)
  routing?: RoutingPolicyDto | null;
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

/** Valida que `writableIds` sea un subconjunto de `knowledgeBaseIds`. */
@ValidatorConstraint({ name: 'writableIdsSubset', async: false })
export class WritableIdsSubsetConstraint implements ValidatorConstraintInterface {
  validate(writableIds: unknown, args: ValidationArguments): boolean {
    if (writableIds === undefined) return true;
    if (!Array.isArray(writableIds)) return false;
    const base = (args.object as SetAgentKnowledgeDto).knowledgeBaseIds;
    const allowed = new Set<unknown>(Array.isArray(base) ? base : []);
    return (writableIds as unknown[]).every((id) => allowed.has(id));
  }

  defaultMessage(): string {
    return 'writableIds debe ser un subconjunto de knowledgeBaseIds';
  }
}

export class SetAgentKnowledgeDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  knowledgeBaseIds!: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Subconjunto de knowledgeBaseIds en las que el agente podrá escribir (save_knowledge)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Validate(WritableIdsSubsetConstraint)
  writableIds?: string[];
}

export class CreateAgentExampleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) input!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10_000) output!: string;
}

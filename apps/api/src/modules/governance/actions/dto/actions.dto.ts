import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const POLICY_EFFECTS = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'] as const;
export type PolicyEffectDto = (typeof POLICY_EFFECTS)[number];

export const POLICY_STATUSES = ['BORRADOR', 'ACTIVA', 'ARCHIVADA'] as const;
export type PolicyStatusDto = (typeof POLICY_STATUSES)[number];

export const APPROVAL_RISKS = ['BAJO', 'MEDIO', 'ALTO'] as const;
export type ApprovalRiskDto = (typeof APPROVAL_RISKS)[number];

export const APPROVAL_DECISIONS = ['APRUEBA', 'RECHAZA', 'AJUSTE'] as const;
export type ApprovalDecisionDto = (typeof APPROVAL_DECISIONS)[number];

export const SUSPENSION_SCOPES = ['AGENTE', 'PROCESO', 'CONECTOR', 'ORGANIZACION'] as const;
export type SuspensionScopeDto = (typeof SUSPENSION_SCOPES)[number];

// ---------- Políticas ----------

export class CreatePoliticaDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre!: string;

  @ApiProperty({ description: 'Tipo de acción (EMAIL_SEND | PAYMENT | DATA_DELETE | ...)' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  tipoAccion!: string;

  @ApiPropertyOptional({ description: 'Empresa (OrgUnit EMPRESA) a la que aplica; vacío = todo el workspace' })
  @IsOptional()
  @IsString()
  empresaId?: string;

  @ApiPropertyOptional({
    description: 'Selector declarativo (agente/usuario/org/recurso/destinatario/monto/dato/horario)',
  })
  @IsOptional()
  @IsObject()
  selector?: Record<string, unknown>;

  @ApiProperty({ enum: POLICY_EFFECTS })
  @IsIn(POLICY_EFFECTS)
  efecto!: PolicyEffectDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 2, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  requiredApprovals?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @ApiPropertyOptional({ enum: POLICY_STATUSES, default: 'ACTIVA' })
  @IsOptional()
  @IsIn(POLICY_STATUSES)
  estado?: PolicyStatusDto;
}

export class UpdatePoliticaDto extends PartialType(CreatePoliticaDto) {}

// ---------- Pasarela de acción ----------

export class ActionRequestDto {
  @ApiProperty({ description: 'Tipo de acción con efecto externo' })
  @IsString()
  @MaxLength(80)
  tipoAccion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proposito?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  empresaId?: string;

  @ApiPropertyOptional({ description: 'Unidad para revalidar presupuesto (reutiliza budgets)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'Versión del agente/plantilla que ejecutará (parte del contentHash)' })
  @IsOptional()
  @IsString()
  agentVersionId?: string;

  @ApiPropertyOptional({ description: 'Herramienta/canal que ejecutará (parte del contentHash)' })
  @IsOptional()
  @IsString()
  herramienta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conectorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recurso?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  operacion?: string;

  @ApiPropertyOptional({ description: 'Proceso/flujo origen (para suspensión por PROCESO)' })
  @IsOptional()
  @IsString()
  procesoId?: string;

  @ApiPropertyOptional({ description: 'Tarea de negocio (E4) que la origina' })
  @IsOptional()
  @IsString()
  tareaId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  destinatarios?: string[];

  @ApiPropertyOptional({ description: 'Parámetros/plantilla exactos de la operación' })
  @IsOptional()
  @IsObject()
  operacionParams?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Contenido del mensaje/acción' })
  @IsOptional()
  @IsObject()
  contenido?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  adjuntos?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  importe?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  moneda?: string;

  @ApiPropertyOptional({ description: 'Clasificación del dato (de DataGuard)' })
  @IsOptional()
  @IsString()
  clasificacionDato?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  horaLocal?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  @ApiPropertyOptional({ description: 'La verificación cruzada (ADR 0010) exige revisión humana' })
  @IsOptional()
  @IsBoolean()
  requiereRevisionCruzada?: boolean;

  @ApiPropertyOptional({ enum: APPROVAL_RISKS, default: 'MEDIO' })
  @IsOptional()
  @IsIn(APPROVAL_RISKS)
  riesgo?: ApprovalRiskDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 720, description: 'Vigencia de la aprobación en horas (por defecto 24)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}

/**
 * Propuesta ACTUAL al ejecutar. Si se informa, el gateway recomputa el `contentHash` sobre ella y lo compara con el
 * aprobado (QA03). Si se omite, se recomputa sobre lo que quedó guardado (siempre coincide).
 */
export class ExecuteActionDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  destinatarios?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  contenido?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  adjuntos?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  operacionParams?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  herramienta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  importe?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  moneda?: string;
}

// ---------- Aprobaciones ----------

export class ApprovalDecisionBodyDto {
  @ApiProperty({ enum: APPROVAL_DECISIONS })
  @IsIn(APPROVAL_DECISIONS)
  decision!: ApprovalDecisionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comentario?: string;
}

// ---------- Suspensiones ----------

export class CreateSuspensionDto {
  @ApiProperty({ enum: SUSPENSION_SCOPES })
  @IsIn(SUSPENSION_SCOPES)
  alcance!: SuspensionScopeDto;

  @ApiProperty({ description: 'Id del agente/flujo/conector/empresa alcanzado' })
  @IsString()
  @MinLength(1)
  targetId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}

export class ReactivateSuspensionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}

/** Filtros de la bandeja. */
export class ApprovalsQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDIENTE', 'APROBADA', 'RECHAZADA', 'AJUSTE', 'EJECUTADA', 'CADUCADA', 'INVALIDADA'],
  })
  @IsOptional()
  @IsString()
  estado?: string;
}

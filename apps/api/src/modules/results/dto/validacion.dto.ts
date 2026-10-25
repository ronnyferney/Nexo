import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Debe coincidir con el enum `ModoValidacion` de Prisma. */
export const MODOS_VALIDACION = ['DETERMINISTA', 'HUMANA', 'ASISTIDA'] as const;
export type ModoValidacionDto = (typeof MODOS_VALIDACION)[number];

/** Debe coincidir con el enum `VeredictoValidacion` de Prisma. */
export const VEREDICTOS = ['ACEPTA', 'DEVUELVE'] as const;
export type VeredictoDto = (typeof VEREDICTOS)[number];

/**
 * Verificación del resultado (RF30). El servicio garantiza que el verificador es distinto del ejecutor. Según el modo:
 * - DETERMINISTA: evalúa `reglaValidacion` contra `contexto` (datos observados del sistema fuente) y la evidencia exigida.
 * - HUMANA: una persona (`validadorUserId` ≠ dueño ejecutor) emite `veredicto`.
 * - ASISTIDA: un agente distinto (`verificadorAgentId` ≠ ejecutor) contrasta; reutiliza la verificación cruzada D4.
 */
export class ValidarResultadoDto {
  @ApiProperty({ enum: MODOS_VALIDACION })
  @IsIn(MODOS_VALIDACION)
  modo!: ModoValidacionDto;

  @ApiPropertyOptional({ description: 'Agente verificador (ASISTIDA). Debe ser distinto del ejecutor.' })
  @IsOptional()
  @IsString()
  verificadorAgentId?: string;

  @ApiPropertyOptional({ description: 'Persona validadora (HUMANA). Debe ser distinta del dueño ejecutor.' })
  @IsOptional()
  @IsString()
  validadorUserId?: string;

  @ApiPropertyOptional({ enum: VEREDICTOS, description: 'Veredicto (obligatorio en modo HUMANA)' })
  @IsOptional()
  @IsIn(VEREDICTOS)
  veredicto?: VeredictoDto;

  @ApiPropertyOptional({ description: 'Datos observados del sistema fuente para evaluar la regla (DETERMINISTA)' })
  @IsOptional()
  @IsObject()
  contexto?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Veredicto del verificador asistido comenzando con "VEREDICTO: OK|PROBLEMA" (ASISTIDA, reutiliza D4)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  critica?: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs de evidencia evaluados' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenciaIds?: string[];

  @ApiPropertyOptional({ description: 'Motivo / código auditable (obligatorio al devolver)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;
}

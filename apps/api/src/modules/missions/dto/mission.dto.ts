import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTOs de misiones transversales (ADR 0016). `workspaceId` NUNCA viaja en el cuerpo: se toma de `@CurrentAuth()`. Las
 * referencias (coordinador, dueño local, orgUnit, objetivo/tarea, canal) se validan por workspace en el servicio;
 * declararlas NO concede acceso (ADR 0007).
 */

/** Crea una misión en estado PROPUESTA. El dueño es un humano; el coordinador (superempleado) es opcional. */
export class CreateMisionDto {
  @ApiProperty({ description: 'Nombre de la misión transversal' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Propósito o alcance de la misión' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  proposito?: string;

  @ApiProperty({ description: 'Resultado transversal esperado (verificable)' })
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  resultadoEsperado!: string;

  @ApiPropertyOptional({ description: 'Indicador de misión (se consolida sobre E10; no reemplaza los de resultado)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  indicador?: string;

  @ApiPropertyOptional({ description: 'Línea base del indicador' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lineaBase?: string;

  @ApiPropertyOptional({ description: 'Meta del indicador' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta?: string;

  @ApiPropertyOptional({ description: 'Plazo comprometido (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  plazo?: string;

  @ApiPropertyOptional({ description: 'Dueño humano (User). Por defecto, quien crea la misión. Referencia blanda' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  duenoUserId?: string;

  @ApiPropertyOptional({
    description: 'Coordinador digital (Agent de nivel SUPEREMPLEADO). Coordinar NO concede acceso',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  coordinadorAgentId?: string;

  @ApiPropertyOptional({ description: 'Canal MISION existente a enlazar (E5/D5). Enlazar NO concede acceso' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  canalId?: string;
}

/** Autoriza una misión (PROPUESTA -> AUTORIZADA). Puede fijar/confirmar el coordinador. */
export class AuthorizeMisionDto {
  @ApiPropertyOptional({ description: 'Coordinador digital a asignar si no se fijó al crear' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  coordinadorAgentId?: string;
}

/** Detiene una misión (-> DETENIDA): bloqueo/escalamiento que exige decisión humana. El motivo es obligatorio. */
export class StopMisionDto {
  @ApiProperty({ description: 'Motivo del escalamiento/detención (código o razón auditable)' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  motivo!: string;
}

/** Cancela una misión (-> CANCELADA). Deja historial; no rompe el trabajo ya aceptado. El motivo es obligatorio. */
export class CancelMisionDto {
  @ApiProperty({ description: 'Motivo de la cancelación (código o razón auditable)' })
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  motivo!: string;
}

/** Declara un participante (empresa/línea/área/sede). Declarar participante NO concede acceso (ADR 0007). */
export class AddParticipanteDto {
  @ApiProperty({ description: 'Empresa/línea/área/sede participante (OrgUnit del workspace)' })
  @IsString()
  @MaxLength(60)
  orgUnitId!: string;

  @ApiPropertyOptional({ description: 'Dueño humano local de la participación (User). No concede acceso' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  duenoLocalUserId?: string;

  @ApiPropertyOptional({ description: 'Agente líder del área en la misión. Nombrarlo NO le concede acceso (ADR 0007)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  agenteLiderId?: string;

  @ApiPropertyOptional({ description: 'Alcance aprobado de la participación (forma JSON versionable)' })
  @IsOptional()
  @IsObject()
  alcance?: Record<string, unknown>;
}

/** Vincula trabajo EXISTENTE (Objetivo y/o Tarea) a la misión, por referencia. Vincular NO concede acceso. */
export class AddVinculoDto {
  @ApiPropertyOptional({ description: 'Objetivo existente a agrupar por referencia' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  objetivoId?: string;

  @ApiPropertyOptional({ description: 'Tarea existente a agrupar por referencia' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tareaId?: string;
}

/** Marca de confirmación humana del dueño para proponer el cierre LOGRADA (D5). Solo informativa en el seguimiento. */
export class ConfirmLogradaQueryDto {
  @ApiPropertyOptional({ description: 'Si el dueño confirma el cierre, el seguimiento evalúa la condición de LOGRADA' })
  @IsOptional()
  @IsBoolean()
  confirmar?: boolean;
}

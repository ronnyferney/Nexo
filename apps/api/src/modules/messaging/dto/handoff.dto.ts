import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Propuesta de handoff / contrato de transferencia (RF09). Cierra el segmento actual en un punto de corte con el
 * estado alcanzado, el entregable parcial, el contexto autorizado, el criterio del siguiente paso, los permisos del
 * tramo entrante y el responsable entrante. El receptor acepta o rechaza; al aceptar se encola el siguiente segmento.
 */
export class ProponerHandoffDto {
  @ApiPropertyOptional({ description: 'Agente saliente (referencia blanda)' })
  @IsOptional()
  @IsString()
  fromAgentId?: string;

  @ApiPropertyOptional({ description: 'Agente entrante (referencia blanda)' })
  @IsOptional()
  @IsString()
  toAgentId?: string;

  @ApiPropertyOptional({ description: 'Equipo/grupo entrante (referencia blanda)' })
  @IsOptional()
  @IsString()
  toEquipoId?: string;

  @ApiPropertyOptional({
    description: 'Estado alcanzado: snapshot/referencias del estado persistido (entrada del siguiente segmento)',
  })
  @IsOptional()
  @IsObject()
  estadoAlcanzado?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Entregable parcial producido hasta el punto de corte' })
  @IsOptional()
  @IsObject()
  entregableParcial?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Contexto autorizado (referencias, no copia de datos sensibles)' })
  @IsOptional()
  @IsArray()
  contextoAutorizado?: unknown[];

  @ApiPropertyOptional({ description: 'Criterio del siguiente paso' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  criterioSiguiente?: string;

  @ApiPropertyOptional({ description: 'Permisos del tramo entrante; NUNCA amplía atribuciones' })
  @IsOptional()
  @IsObject()
  permisos?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Responsable humano entrante (referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableEntranteUserId?: string;

  @ApiPropertyOptional({
    description: 'Flujo que ejecuta el segmento entrante al aceptar (referencia blanda a Workflow)',
  })
  @IsOptional()
  @IsString()
  workflowId?: string;

  @ApiProperty({ description: 'messageId de idempotencia del MensajeAgente HANDOFF que acompaña la propuesta' })
  @IsString()
  @MaxLength(200)
  messageId!: string;
}

/** Aceptación del handoff (RF33). messageId del MensajeAgente de ACEPTACION. Opcional: flujo del segmento entrante. */
export class AceptarHandoffDto {
  @ApiProperty({ description: 'messageId de idempotencia del MensajeAgente ACEPTACION' })
  @IsString()
  @MaxLength(200)
  messageId!: string;

  @ApiPropertyOptional({ description: 'Flujo que ejecuta el segmento entrante (si no se fijó en la propuesta)' })
  @IsOptional()
  @IsString()
  workflowId?: string;

  @ApiPropertyOptional({ description: 'Agente que acepta (referencia blanda)' })
  @IsOptional()
  @IsString()
  aceptaAgentId?: string;
}

/** Rechazo del handoff (RF33): devuelve al emisor con motivo (conserva trazabilidad). */
export class RechazarHandoffDto {
  @ApiProperty({ description: 'messageId de idempotencia del MensajeAgente de DEVOLUCION' })
  @IsString()
  @MaxLength(200)
  messageId!: string;

  @ApiProperty({ description: 'Motivo del rechazo (auditable)' })
  @IsString()
  @MaxLength(1000)
  motivo!: string;
}

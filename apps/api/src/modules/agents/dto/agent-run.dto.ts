import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Estados de `AgentRun` (ver `schema.prisma`). */
export const AGENT_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type AgentRunStatusFilter = (typeof AGENT_RUN_STATUSES)[number];

/** Orígenes de ejecución (`UsageSource` en `schema.prisma`). */
export const AGENT_RUN_SOURCES = ['CHAT', 'WORKFLOW', 'MCP', 'ROUTINE', 'EVAL', 'COPILOT'] as const;
export type AgentRunSourceFilter = (typeof AGENT_RUN_SOURCES)[number];

/**
 * Filtros y paginación del historial de ejecuciones de agente (RX-14). Solo lectura. La paginación es por cursor
 * (sobre el `id` de la última fila de la página anterior) y el orden es siempre por `startedAt` descendente.
 */
export class ListAgentRunsQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por un agente concreto (debe ser visible para el solicitante)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentId?: string;

  @ApiPropertyOptional({ enum: AGENT_RUN_STATUSES })
  @IsOptional()
  @IsIn(AGENT_RUN_STATUSES)
  status?: AgentRunStatusFilter;

  @ApiPropertyOptional({ enum: AGENT_RUN_SOURCES })
  @IsOptional()
  @IsIn(AGENT_RUN_SOURCES)
  source?: AgentRunSourceFilter;

  @ApiPropertyOptional({ description: 'Desde (ISO 8601), inclusive, sobre startedAt' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta (ISO 8601), inclusive, sobre startedAt' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100, description: 'Tamaño de página (1..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @ApiPropertyOptional({ description: 'Cursor: id de la última fila de la página anterior (nextCursor)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

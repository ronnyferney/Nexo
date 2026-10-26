import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Filtros de la consola de auditoría (E13). Solo lectura; `workspaceId` lo pone el servidor desde `@CurrentAuth`. */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Acción auditada (APROBACION_CONCEDIDA, SUSPENSION_ACTIVADA, ...)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ description: 'Tipo de entidad afectada (Aprobacion, Suspension, Politica, ...)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetType?: string;

  @ApiPropertyOptional({ description: 'Id de la entidad afectada' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetId?: string;

  @ApiPropertyOptional({ description: 'Desde (ISO-8601 inclusive)' })
  @IsOptional()
  @IsISO8601()
  desde?: string;

  @ApiPropertyOptional({ description: 'Hasta (ISO-8601 inclusive)' })
  @IsOptional()
  @IsISO8601()
  hasta?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @ApiPropertyOptional({ description: 'Id de la última entrada de la página anterior (paginación por cursor)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

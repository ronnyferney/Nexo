import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Filtros de los indicadores de resultado (E10 · sección 9). Todos opcionales. El `workspaceId` NUNCA llega por aquí:
 * se toma de `@CurrentAuth()` (multi-tenant). `empresaId`/`areaId` son `OrgUnit` (referencias blandas, validadas por
 * pertenencia en el servicio); `agentId` es el agente ejecutor/imputado. Sin `from`/`to` se usa la ventana por defecto.
 */
export class IndicadoresQueryDto {
  @ApiPropertyOptional({ description: 'Inicio del período (ISO 8601). Por defecto: hace 30 días.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fin del período (ISO 8601). Por defecto: ahora.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Empresa (OrgUnit tipo EMPRESA). Incluye sus unidades por `empresaId`.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  empresaId?: string;

  @ApiPropertyOptional({ description: 'Área / unidad (OrgUnit). Filtra las tareas con ese `orgUnitId`.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  areaId?: string;

  @ApiPropertyOptional({ description: 'Agente ejecutor (empleado digital) al que se atribuyen tareas/costos.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  agentId?: string;
}

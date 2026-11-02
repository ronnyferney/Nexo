import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Publicar una plantilla a partir de un agente existente (ADR 0019 · Inc.1). `workspaceId` NUNCA viaja en el cuerpo:
 * se toma de `@CurrentAuth`. El payload de la plantilla lo SANEA el servicio (sin secretos, sin responsable).
 */
export class PublishAgentTemplateDto {
  @ApiProperty({ description: 'Agente de origen (del workspace actual) a partir del cual se publica la plantilla' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  agentId!: string;

  @ApiPropertyOptional({ description: 'Nombre de la plantilla; por defecto el nombre del agente de origen' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  nombre?: string;

  @ApiPropertyOptional({ description: 'Área/proceso de alcance, descriptivo para descubrir y filtrar' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @ApiPropertyOptional({ description: 'Notas de la versión publicada (changelog)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notas?: string;
}

/**
 * Instalar una plantilla: crea un agente BORRADOR en el workspace actual desde la versión indicada (la última si se
 * omite). Sin responsable (no se puede lanzar) y sin secretos.
 */
export class InstallAgentTemplateDto {
  @ApiPropertyOptional({ description: 'Versión a instalar (correlativo por plantilla); por defecto la última' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

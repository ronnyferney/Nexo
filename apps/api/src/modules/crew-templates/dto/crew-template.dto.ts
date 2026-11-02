import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Publicar una plantilla de cuadrilla a partir de una Cuadrilla existente (ADR 0019 · Inc.3). `workspaceId` NUNCA viaja
 * en el cuerpo: se toma de `@CurrentAuth`. El payload (composición) lo SANEA el servicio (sin secretos, sin responsables).
 */
export class PublishCrewTemplateDto {
  @ApiProperty({
    description: 'Cuadrilla de origen (del workspace actual) a partir de la cual se publica la plantilla',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cuadrillaId!: string;

  @ApiPropertyOptional({ description: 'Nombre de la plantilla; por defecto el nombre de la cuadrilla de origen' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre?: string;

  @ApiPropertyOptional({ description: 'Notas de la versión publicada (changelog)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notas?: string;
}

/**
 * Instalar una plantilla de cuadrilla: crea una Cuadrilla BORRADOR en el workspace actual desde la versión indicada (la
 * última si se omite). Sin responsables (queda como borrador gobernado) y sin secretos.
 */
export class InstallCrewTemplateDto {
  @ApiPropertyOptional({ description: 'Versión a instalar (correlativo por plantilla); por defecto la última' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de un perfil de organización (ADR 0018 Inc.1). El perfil es CONTEXTO, no concede permisos y no admite
 * secretos. El `workspaceId` NUNCA llega en el cuerpo: se toma de `@CurrentAuth()`.
 */
export class CreateOrganizacionDto {
  @ApiProperty({ description: 'Nombre de la organización' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Dominio principal (único por workspace)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dominio?: string;

  @ApiPropertyOptional({ description: 'Tipo o sector de la organización' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tipoSector?: string;

  @ApiPropertyOptional({ description: 'Notas libres sobre la organización' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notas?: string;

  @ApiPropertyOptional({ description: 'Procedencia del dato (p. ej. correo, carga manual)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fuente?: string;
}

/** Edición parcial del perfil de organización; todos los campos opcionales en PATCH. */
export class UpdateOrganizacionDto extends PartialType(CreateOrganizacionDto) {}

/** Consulta de organización por dominio (ADR 0018 Inc.2): la ficha del buzón resuelve el perfil del remitente. */
export class BuscarOrganizacionPorDominioDto {
  @ApiProperty({ description: 'Dominio a resolver (p. ej. acme.com)' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  dominio!: string;
}

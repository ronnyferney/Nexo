import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Debe coincidir con el enum `PublicacionTipo` de Prisma. */
export const TIPOS_PUBLICACION = ['NOVEDAD', 'APOYO', 'APRENDIZAJE', 'COMPROMISO'] as const;
export type PublicacionTipoDto = (typeof TIPOS_PUBLICACION)[number];

/** Debe coincidir con el enum `PublicacionEstado` de Prisma. */
export const ESTADOS_PUBLICACION = ['ACTIVA', 'RESUELTA', 'ARCHIVADA'] as const;
export type PublicacionEstadoDto = (typeof ESTADOS_PUBLICACION)[number];

/** Tipos de reacción admitidos en el muro (etiqueta corta; contenido social, no ejecutable). */
export const TIPOS_REACCION = ['like', 'celebrar', 'apoyo'] as const;
export type ReaccionTipoDto = (typeof TIPOS_REACCION)[number];

export class CrearPublicacionDto {
  @ApiProperty({ enum: TIPOS_PUBLICACION })
  @IsIn(TIPOS_PUBLICACION)
  tipo!: PublicacionTipoDto;

  @ApiPropertyOptional({ description: 'Título opcional de la publicación' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;

  @ApiProperty({ description: 'Cuerpo de la publicación (texto; no se expande con plantillas)' })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  cuerpo!: string;

  @ApiPropertyOptional({ description: 'Alcance a un área/empresa (OrgUnit, referencia blanda)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional({ description: 'Tarea ligada (solo COMPROMISO/APOYO; referencia blanda al mismo workspace)' })
  @IsOptional()
  @IsString()
  tareaId?: string;
}

/** Actualización por el autor o un ADMIN+: ajustar texto o cambiar estado (p. ej. marcar un APOYO como RESUELTA). */
export class ActualizarPublicacionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  cuerpo?: string;

  @ApiPropertyOptional({ enum: ESTADOS_PUBLICACION })
  @IsOptional()
  @IsIn(ESTADOS_PUBLICACION)
  estado?: PublicacionEstadoDto;
}

/** Filtros del muro (feed). Paginación por offset. */
export class ListarPublicacionesQueryDto {
  @ApiPropertyOptional({ enum: TIPOS_PUBLICACION })
  @IsOptional()
  @IsIn(TIPOS_PUBLICACION)
  tipo?: PublicacionTipoDto;

  @ApiPropertyOptional({ enum: ESTADOS_PUBLICACION })
  @IsOptional()
  @IsIn(ESTADOS_PUBLICACION)
  estado?: PublicacionEstadoDto;

  @ApiPropertyOptional({ description: 'Alcance a un área/empresa (OrgUnit)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

export class CrearComentarioDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  cuerpo!: string;
}

export class CrearReaccionDto {
  @ApiProperty({ enum: TIPOS_REACCION })
  @IsIn(TIPOS_REACCION)
  tipo!: ReaccionTipoDto;
}

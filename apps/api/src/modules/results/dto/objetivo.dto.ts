import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Objetivo (RF07): indicador, línea base, meta, plazo, dueño humano y responsable digital. */
export class CreateObjetivoDto {
  @ApiProperty({ description: 'Código estable del objetivo (único por workspace)' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  codigo!: string;

  @ApiProperty({ description: 'Nombre del objetivo' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Empresa / área / línea de negocio (OrgUnit, referencia blanda)' })
  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @ApiPropertyOptional({ description: 'Indicador con el que se mide el objetivo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  indicador?: string;

  @ApiPropertyOptional({ description: 'Línea base (punto de partida)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  lineaBase?: string;

  @ApiPropertyOptional({ description: 'Meta a alcanzar' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta?: string;

  @ApiPropertyOptional({ description: 'Plazo de negocio (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  plazo?: string;

  @ApiPropertyOptional({ description: 'Dueño humano (User, referencia blanda)' })
  @IsOptional()
  @IsString()
  duenoUserId?: string;

  @ApiPropertyOptional({ description: 'Responsable digital (Agent, referencia blanda)' })
  @IsOptional()
  @IsString()
  responsableAgentId?: string;
}

export class UpdateObjetivoDto extends PartialType(CreateObjetivoDto) {}

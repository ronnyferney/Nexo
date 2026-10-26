import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Niveles jerárquicos esperados (coincide con el enum `NivelJerarquico`). Texto libre validado como string. */
export const NIVELES_JERARQUICOS = ['EMPLEADO', 'LIDER', 'JEFE', 'DIRECTOR', 'GERENTE', 'SUPEREMPLEADO'] as const;

/** Crea una plantilla de Cuadrilla en estado BORRADOR. La configuración vive en sus versiones, no aquí. */
export class CreateCrewDto {
  @ApiProperty({ description: 'Nombre de la plantilla de Cuadrilla' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Propósito o misión del equipo' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proposito?: string;

  @ApiPropertyOptional({ description: 'Proceso de negocio que la Cuadrilla dota' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  procesoObjetivo?: string;

  @ApiPropertyOptional({ description: 'Empresa/área de alcance (OrgUnit). Referencia blanda; no concede acceso' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  orgUnitId?: string;
}

/** Un rol del equipo dentro de una versión. 100 % declarativo: el validador rechaza claves/contenido ejecutable. */
export class CrewMemberDto {
  @ApiProperty({ description: 'Nombre del rol dentro del equipo' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  rol!: string;

  @ApiPropertyOptional({ description: 'Cargo que desempeña el rol (ADR 0011)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cargoId?: string;

  @ApiPropertyOptional({ enum: NIVELES_JERARQUICOS, description: 'Nivel jerárquico esperado' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nivelEsperado?: string;

  @ApiPropertyOptional({ type: [String], description: 'Ids de Skill sugeridos (SUGERENCIA, no concesión)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: 'Referencias a conector/operación sugeridas (declarativo; NO concede acceso)' })
  @IsOptional()
  @IsArray()
  conectoresSugeridos?: unknown[];

  @ApiPropertyOptional({ description: 'Referencia a Politica (E6) o su forma declarativa' })
  @IsOptional()
  @IsObject()
  politicaSugerida?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Forma declarativa de ContratoResultado (reglaValidacion, evidenciaExigida)' })
  @IsOptional()
  @IsObject()
  criteriosResultado?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String], description: 'Roles/ids de miembro a los que puede delegar (subconjunto)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  delegaA?: string[];
}

/** Crea una versión nueva (append-only) con sus miembros. Nunca reescribe una versión existente. */
export class CreateCrewVersionDto {
  @ApiPropertyOptional({ description: 'Metadatos declarativos de la versión (notas, criterios globales)' })
  @IsOptional()
  @IsObject()
  definicion?: Record<string, unknown>;

  @ApiProperty({ type: [CrewMemberDto], description: 'Miembros (roles) del equipo en esta versión' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  miembros!: CrewMemberDto[];
}

/** Asigna un responsable humano a un rol al instanciar (opcional). */
export class CrewResponsableDto {
  @ApiProperty({ description: 'Rol del miembro' })
  @IsString()
  @MaxLength(120)
  rol!: string;

  @ApiProperty({ description: 'Usuario humano responsable del agente que desempeñará el rol' })
  @IsString()
  @MaxLength(60)
  responsableUserId!: string;
}

/** Instancia una versión PUBLICADA. No concede acceso: devuelve los permisos pendientes de conceder. */
export class InstantiateCrewDto {
  @ApiPropertyOptional({ description: 'Versión exacta a instanciar. Por defecto, la última versión de la plantilla' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  versionId?: string;

  @ApiPropertyOptional({ description: 'Empresa/área donde se dota el equipo (OrgUnit). No concede acceso' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  orgUnitId?: string;

  @ApiPropertyOptional({ type: [CrewResponsableDto], description: 'Responsables humanos por rol (opcional)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CrewResponsableDto)
  responsables?: CrewResponsableDto[];
}

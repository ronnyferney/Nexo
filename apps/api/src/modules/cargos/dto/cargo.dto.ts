import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Niveles jerárquicos del cargo (RF03, base de E3/RF32). Debe coincidir con el enum `NivelJerarquico` de Prisma. */
export const NIVELES_JERARQUICOS = ['EMPLEADO', 'LIDER', 'JEFE', 'DIRECTOR', 'GERENTE', 'SUPEREMPLEADO'] as const;
export type NivelJerarquico = (typeof NIVELES_JERARQUICOS)[number];

export class CreateCargoDto {
  @ApiProperty({ description: 'Nombre del cargo' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Propósito o misión del cargo' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proposito?: string;

  @ApiPropertyOptional({ type: [String], description: 'Funciones principales del cargo' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  funciones?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Entregables o productos esperados' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  entregables?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Indicadores de desempeño del cargo' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  indicadores?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Límites: lo que el cargo NO debe hacer' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  limites?: string[];

  @ApiPropertyOptional({ enum: NIVELES_JERARQUICOS, default: 'EMPLEADO', description: 'Nivel jerárquico (RF03/E3)' })
  @IsOptional()
  @IsIn(NIVELES_JERARQUICOS)
  nivel?: NivelJerarquico;

  @ApiPropertyOptional({ default: true, description: 'Un cargo inactivo deja de ofrecerse para asignar' })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

/** El nombre y demás campos se pueden editar; todos opcionales en PATCH. */
export class UpdateCargoDto extends PartialType(CreateCargoDto) {}

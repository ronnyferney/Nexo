import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  ContextoCumplimiento,
  NivelRiesgo,
  ReglaValidacionDeclarativa,
  TipoDatoCumplimiento,
} from '../cumplimiento.resolver';

/** Niveles de riesgo del alcance (coincide con el enum `NivelRiesgo`). Genérico y multisectorial. */
export const NIVELES_RIESGO = ['BAJO', 'MEDIO', 'ALTO', 'CRITICO', 'DESCONOCIDO'] as const;

/** Tipos de dato de un campo obligatorio (coincide con el enum `TipoDatoCumplimiento`). Forma, no semántica sectorial. */
export const TIPOS_DATO = ['TEXTO', 'NUMERO', 'BOOLEANO', 'FECHA', 'LISTA', 'OBJETO'] as const;

/**
 * Crea una regla de la matriz de cumplimiento configurable (P1.3 · ADR 0020). El ALCANCE es la combinación
 * jurisdicción/sector/proceso/nivelRiesgo; omitir una dimensión la deja como comodín (aplica a todas). Todo es DATO
 * configurable: NO hay semántica de ningún sector en el código. Nace INACTIVA por defecto (no exige nada hasta que un
 * ADMIN la active y el patrocinador apruebe el conjunto). Solo ADMIN+.
 */
export class CreateReglaCumplimientoDto {
  @ApiPropertyOptional({ description: 'Jurisdicción (texto libre, p. ej. "EC"); omitir = todas (comodín)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jurisdiccion?: string;

  @ApiPropertyOptional({ description: 'Sector económico (texto libre, p. ej. "financiero"); omitir = todos (comodín)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sector?: string;

  @ApiPropertyOptional({ description: 'Proceso (texto libre, p. ej. "cobranza"); omitir = todos (comodín)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  proceso?: string;

  @ApiPropertyOptional({ enum: NIVELES_RIESGO, description: 'Nivel de riesgo; omitir = todos (comodín)' })
  @IsOptional()
  @IsIn(NIVELES_RIESGO, { message: 'nivelRiesgo debe ser BAJO, MEDIO, ALTO, CRITICO o DESCONOCIDO' })
  nivelRiesgo?: NivelRiesgo;

  @ApiProperty({ description: 'Clave del campo obligatorio (identificador en inglés, p. ej. "baseLegalTratamiento")' })
  @IsString()
  @IsNotEmpty({ message: 'campoClave es obligatorio' })
  @MaxLength(120)
  campoClave!: string;

  @ApiProperty({ enum: TIPOS_DATO, description: 'Tipo de dato esperado del campo (forma, no semántica sectorial)' })
  @IsIn(TIPOS_DATO, { message: 'tipoDato debe ser TEXTO, NUMERO, BOOLEANO, FECHA, LISTA u OBJETO' })
  tipoDato!: TipoDatoCumplimiento;

  @ApiPropertyOptional({
    type: Object,
    description: 'Regla declarativa opcional (JSON: { requerido, patron, min, max, enum, longitudMin, longitudMax })',
  })
  @IsOptional()
  @IsObject({ message: 'reglaValidacion debe ser un objeto declarativo' })
  reglaValidacion?: ReglaValidacionDeclarativa;

  @ApiPropertyOptional({ description: 'Control de protección de datos aplicable (texto/clave, p. ej. "minimización")' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  controlProteccion?: string;

  @ApiPropertyOptional({ description: 'Descripción legible del requisito' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @ApiPropertyOptional({
    description: 'Activa la regla (por defecto false: no exige nada hasta aprobación del patrocinador)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** Actualiza una regla de cumplimiento. Todos los campos son opcionales (PATCH parcial). Solo ADMIN+. */
export class UpdateReglaCumplimientoDto extends PartialType(CreateReglaCumplimientoDto) {}

/** Filtro de alcance para resolver el conjunto de reglas aplicables (`GET .../compliance/resolve`). */
export class ResolverCumplimientoDto {
  @ApiPropertyOptional({ description: 'Jurisdicción del contexto' })
  @IsOptional()
  @IsString()
  jurisdiccion?: string;

  @ApiPropertyOptional({ description: 'Sector económico del contexto' })
  @IsOptional()
  @IsString()
  sector?: string;

  @ApiPropertyOptional({ description: 'Proceso del contexto' })
  @IsOptional()
  @IsString()
  proceso?: string;

  @ApiPropertyOptional({ enum: NIVELES_RIESGO, description: 'Nivel de riesgo del contexto' })
  @IsOptional()
  @IsIn(NIVELES_RIESGO)
  nivelRiesgo?: NivelRiesgo;

  @ApiPropertyOptional({
    description: 'Incluir también reglas INACTIVAS (solo vista previa de configuración; no se usan para validar)',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  incluirInactivas?: boolean;
}

/** Contexto de evaluación de un resultado/pasaporte contra la matriz (parte del cuerpo de `POST .../compliance/validate`). */
export class ContextoCumplimientoDto implements ContextoCumplimiento {
  @ApiPropertyOptional({ description: 'Jurisdicción del contexto' })
  @IsOptional()
  @IsString()
  jurisdiccion?: string;

  @ApiPropertyOptional({ description: 'Sector económico del contexto' })
  @IsOptional()
  @IsString()
  sector?: string;

  @ApiPropertyOptional({ description: 'Proceso del contexto' })
  @IsOptional()
  @IsString()
  proceso?: string;

  @ApiPropertyOptional({ enum: NIVELES_RIESGO, description: 'Nivel de riesgo del contexto' })
  @IsOptional()
  @IsIn(NIVELES_RIESGO)
  nivelRiesgo?: NivelRiesgo;
}

/**
 * Evalúa de forma ASESORA (no bloqueante) un conjunto de valores (p. ej. los campos de un pasaporte/resultado) contra
 * las reglas ACTIVAS aplicables al contexto. Solo lectura: devuelve cumple/faltantes, no persiste ni bloquea.
 */
export class ValidarCumplimientoDto {
  @ApiProperty({ type: ContextoCumplimientoDto, description: 'Contexto que determina las reglas aplicables' })
  @IsObject()
  contexto!: ContextoCumplimientoDto;

  @ApiProperty({
    type: Object,
    description: 'Valores a evaluar (objeto campoClave → valor), p. ej. los campos del pasaporte/resultado',
  })
  @IsObject({ message: 'valores debe ser un objeto { campoClave: valor }' })
  valores!: Record<string, unknown>;
}

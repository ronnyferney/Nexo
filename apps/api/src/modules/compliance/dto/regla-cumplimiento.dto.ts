import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import type {
  ContextoCumplimiento,
  NivelRiesgo,
  ReglaValidacionDeclarativa,
  TipoDatoCumplimiento,
} from '../cumplimiento.resolver';

/**
 * Coherencia de la ventana de vigencia: si se envían AMBOS extremos, `vigenciaDesde` debe ser anterior o igual a
 * `vigenciaHasta`. Si falta cualquiera de los dos (extremo abierto), no hay nada que comparar y se considera válido.
 */
@ValidatorConstraint({ name: 'vigenciaCoherente', async: false })
export class VigenciaCoherenteConstraint implements ValidatorConstraintInterface {
  validate(_valor: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { vigenciaDesde?: string; vigenciaHasta?: string };
    if (!obj.vigenciaDesde || !obj.vigenciaHasta) return true;
    const desde = Date.parse(obj.vigenciaDesde);
    const hasta = Date.parse(obj.vigenciaHasta);
    if (Number.isNaN(desde) || Number.isNaN(hasta)) return true; // el formato lo valida @IsISO8601
    return desde <= hasta;
  }

  defaultMessage(): string {
    return 'vigenciaDesde debe ser anterior o igual a vigenciaHasta';
  }
}

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

  @ApiPropertyOptional({
    description: 'Inicio de vigencia (fecha/hora ISO 8601, inclusive); omitir/null = sin límite inferior',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'vigenciaDesde debe ser una fecha ISO 8601' })
  vigenciaDesde?: string;

  @ApiPropertyOptional({
    description: 'Fin de vigencia (fecha/hora ISO 8601, inclusive); omitir/null = sin límite superior',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'vigenciaHasta debe ser una fecha ISO 8601' })
  @Validate(VigenciaCoherenteConstraint)
  vigenciaHasta?: string;
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
    description: 'Fecha de evaluación de la vigencia (ISO 8601); por defecto «ahora»',
    example: '2026-06-15T12:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'fechaEvaluacion debe ser una fecha ISO 8601' })
  fechaEvaluacion?: string;

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

  @ApiPropertyOptional({
    description: 'Fecha de evaluación de la vigencia (ISO 8601); por defecto «ahora»',
    example: '2026-06-15T12:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'fechaEvaluacion debe ser una fecha ISO 8601' })
  fechaEvaluacion?: string;
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

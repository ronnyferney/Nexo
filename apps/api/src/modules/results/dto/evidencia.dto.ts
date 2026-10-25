import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Evidencia del resultado: REFERENCIA autorizada a la fuente (id externo, ejecución, enlace), no copia de datos
 * sensibles (RF35). Puede colgar de la tarea o del contrato.
 */
export class CrearEvidenciaDto {
  @ApiProperty({ description: 'Tipo de evidencia (debe coincidir con la evidencia exigida del contrato)' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  tipo!: string;

  @ApiPropertyOptional({ description: 'Descripción de la evidencia' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Referencia a la fuente { connectorOpId?, externalId?, executionId?, url? }' })
  @IsOptional()
  @IsObject()
  referencia?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Hash del registro fuente (integridad)' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  hash?: string;

  @ApiPropertyOptional({ description: 'Propietario de la evidencia (User, referencia blanda)' })
  @IsOptional()
  @IsString()
  propietarioUserId?: string;

  @ApiPropertyOptional({ description: 'Vigencia de la evidencia (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  vigenteHasta?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Asignación de parámetros de ejecución a un empleado digital (E8). Todos los campos son opcionales: solo se
 * actualiza lo presente en el cuerpo. `estacionVirtualId = null` desasigna la estación; `undefined` la deja igual.
 */
export class SetParametrosEjecucionDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Id de la estación virtual a asignar; `null` desasigna. Debe existir en el mismo workspace',
  })
  @IsOptional()
  // Permite explícitamente el valor `null` (desasignar) sin disparar la validación de string.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  estacionVirtualId?: string | null;

  @ApiPropertyOptional({
    description:
      'Gate de salida a internet: false = sin llamadas salientes; true habilita (la salida SIEMPRE pasa por ' +
      'HttpClientService: SSRF/allowlist/timeout/tamaño). La bandera es un gate adicional, nunca un bypass',
  })
  @IsOptional()
  @IsBoolean()
  salidaInternet?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Parámetros de ejecución extensibles (p. ej. horario de operación, límites)',
  })
  @IsOptional()
  @IsObject()
  parametrosEjecucion?: Record<string, unknown>;
}

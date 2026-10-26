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
      'LEGADO: gate único de salida a internet. Reemplazado por `navegacionWeb` y `sistemasAutorizados`. Si se envía, ' +
      'se refleja en ambas categorías (compatibilidad con la UI anterior). Prefiera las categorías.',
    deprecated: true,
  })
  @IsOptional()
  @IsBoolean()
  salidaInternet?: boolean;

  @ApiPropertyOptional({
    description:
      'Candado · navegación/fetch web general: false = no navega; true habilita (la salida SIEMPRE pasa por ' +
      'HttpClientService). Gate adicional, nunca un bypass. Aplica con o sin estación asignada.',
  })
  @IsOptional()
  @IsBoolean()
  navegacionWeb?: boolean;

  @ApiPropertyOptional({
    description:
      'Candado · conexión a conectores/sistemas de negocio autorizados (REST/SOAP/GraphQL/MCP): false = no conecta; ' +
      'true habilita (la salida SIEMPRE pasa por HttpClientService). Gate adicional, nunca un bypass. Aplica con o ' +
      'sin estación asignada.',
  })
  @IsOptional()
  @IsBoolean()
  sistemasAutorizados?: boolean;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Parámetros de ejecución extensibles (p. ej. horario de operación, límites)',
  })
  @IsOptional()
  @IsObject()
  parametrosEjecucion?: Record<string, unknown>;
}

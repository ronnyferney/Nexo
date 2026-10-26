import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const ESTADOS_EXCEPCION = [
  'ABIERTA',
  'EN_PROGRESO',
  'CONCILIADA',
  'REASIGNADA',
  'CANCELADA',
  'RESUELTA',
] as const;
export type EstadoExcepcionDto = (typeof ESTADOS_EXCEPCION)[number];

/** Filtros de la bandeja de excepciones. */
export class ExcepcionesQueryDto {
  @ApiPropertyOptional({ enum: ESTADOS_EXCEPCION })
  @IsOptional()
  @IsIn(ESTADOS_EXCEPCION)
  estado?: EstadoExcepcionDto;

  @ApiPropertyOptional({ description: 'Filtra por tarea de negocio (E4)' })
  @IsOptional()
  @IsString()
  tareaId?: string;
}

/** Aportar información a una excepción (RF21): no cambia el efecto, deja evidencia/contexto en el historial. */
export class AportarInfoDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  nota!: string;

  @ApiPropertyOptional({ description: 'Evidencia referenciada (no copia de datos sensibles)' })
  @IsOptional()
  @IsObject()
  evidencia?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Siguiente acción propuesta' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  siguienteAccion?: string;
}

/** Reasignar el dueño de una excepción (RF21). */
export class ReasignarExcepcionDto {
  @ApiProperty({ description: 'Nuevo dueño humano de la excepción' })
  @IsString()
  @MinLength(1)
  duenoUserId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/** Cancelar una excepción (RF21): la cierra sin conciliar; conserva el historial. */
export class CancelarExcepcionDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  motivo!: string;
}

/** Conciliar una excepción (RF20/RF21): registra el estado verificado en el destino. */
export class ConciliarExcepcionDto {
  @ApiProperty({ description: 'Resultado de la verificación contra el destino', enum: ['CONFIRMADO', 'NO_OCURRIO'] })
  @IsIn(['CONFIRMADO', 'NO_OCURRIO'])
  resultado!: 'CONFIRMADO' | 'NO_OCURRIO';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detalle?: string;
}

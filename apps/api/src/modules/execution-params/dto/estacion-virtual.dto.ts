import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Estados de una estación virtual (E8). Debe coincidir con el enum `EstadoEstacion` de Prisma. */
export const ESTADOS_ESTACION = ['ACTIVA', 'SUSPENDIDA', 'RETIRADA'] as const;
export type EstadoEstacion = (typeof ESTADOS_ESTACION)[number];

export class CreateEstacionVirtualDto {
  @ApiProperty({ description: 'Nombre de la estación virtual (único por workspace)' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Descripción de la estación' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @ApiPropertyOptional({
    description:
      'Etiqueta NO secreta del proveedor de la máquina ("interna" | "azure" | "aws" ...). Nunca credenciales',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  proveedor?: string;
}

/**
 * Actualización de una estación. El `estado` es editable (incluye la baja lógica a `RETIRADA`), pero la vía
 * recomendada para retirar es `DELETE /estaciones-virtuales/:id`, que además audita el retiro.
 */
export class UpdateEstacionVirtualDto extends PartialType(CreateEstacionVirtualDto) {
  @ApiPropertyOptional({ enum: ESTADOS_ESTACION, description: 'Estado de la estación (ciclo de vida del recurso)' })
  @IsOptional()
  @IsIn(ESTADOS_ESTACION)
  estado?: EstadoEstacion;
}

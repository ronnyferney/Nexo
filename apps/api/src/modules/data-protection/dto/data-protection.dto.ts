import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DATA_GUARD_MODES, type DataGuardMode } from '../../llm/data-guard/mask-session';

/** `PUT /admin/data-protection/policy` (ADR 0008 D2 y D7). Los campos omitidos no cambian. */
export class UpdateDataPolicyDto {
  @ApiPropertyOptional({
    enum: DATA_GUARD_MODES,
    description: 'off = sin enmascarar datos personales · mask = enmascarar con reversión · block = rechazar',
  })
  @IsOptional()
  @IsIn(DATA_GUARD_MODES, { message: 'dataGuardMode debe ser off, mask o block' })
  dataGuardMode?: DataGuardMode;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 3650,
    description: 'Días que se conservan conversaciones y mensajes; null = sin límite',
  })
  @IsOptional()
  @IsInt({ message: 'conversationRetentionDays debe ser un número entero de días' })
  @Min(1, { message: 'La retención mínima es de 1 día' })
  @Max(3650, { message: 'La retención máxima es de 3650 días' })
  conversationRetentionDays?: number | null;
}

/** `POST /admin/data-protection/test`: probar la detección sobre un texto de ejemplo. */
export class TestDataPolicyDto {
  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @MaxLength(20000)
  text!: string;
}

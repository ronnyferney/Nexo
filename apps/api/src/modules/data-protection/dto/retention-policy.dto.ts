import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { CanalRetencion, TipoInformacion } from '../retention-policy.resolver';

/** Canales a los que puede acotarse una política (coincide con el enum `CanalRetencion`). */
export const CANALES_RETENCION = ['CORREO', 'WHATSAPP', 'VOZ', 'CHAT'] as const;

/** Tipos de información diferenciables (coincide con el enum `TipoInformacion`). */
export const TIPOS_INFORMACION = ['ORDINARIA', 'EVIDENCIA', 'SENSIBLE'] as const;

/**
 * Crea/actualiza (upsert por alcance) una política de retención diferenciada (P0.2). El alcance es la combinación
 * `canal` + `tipoInformacion`; omitir una dimensión (o enviarla null) la deja como comodín (aplica a todas). Solo
 * ADMIN+. No declara cumplimiento normativo ni valor probatorio: son controles técnicos.
 */
export class UpsertRetentionPolicyDto {
  @ApiPropertyOptional({
    enum: CANALES_RETENCION,
    nullable: true,
    description: 'Canal al que aplica; omitir o null = todos los canales',
  })
  @IsOptional()
  @IsIn(CANALES_RETENCION, { message: 'canal debe ser CORREO, WHATSAPP, VOZ o CHAT' })
  canal?: CanalRetencion | null;

  @ApiPropertyOptional({
    enum: TIPOS_INFORMACION,
    nullable: true,
    description: 'Tipo de información al que aplica; omitir o null = todos los tipos',
  })
  @IsOptional()
  @IsIn(TIPOS_INFORMACION, { message: 'tipoInformacion debe ser ORDINARIA, EVIDENCIA o SENSIBLE' })
  tipoInformacion?: TipoInformacion | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: 3650,
    description: 'Plazo de conservación en días; null = sin plazo propio (hereda la retención del workspace)',
  })
  @IsOptional()
  @IsInt({ message: 'retencionDias debe ser un número entero de días' })
  @Min(1, { message: 'La retención mínima es de 1 día' })
  @Max(3650, { message: 'La retención máxima es de 3650 días' })
  retencionDias?: number | null;

  @ApiPropertyOptional({ description: 'Habilita la eliminación segura al vencer el plazo', default: false })
  @IsOptional()
  @IsBoolean()
  eliminacionSegura?: boolean;

  @ApiPropertyOptional({
    description: 'Marca que el tratamiento de este alcance requiere consentimiento',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  consentimientoRequerido?: boolean;
}

/** Filtro para resolver la política vigente de un alcance (`GET .../retention-policies/resolve`). */
export class ResolveRetentionPolicyDto {
  @ApiProperty({ enum: CANALES_RETENCION, required: false })
  @IsOptional()
  @IsIn(CANALES_RETENCION)
  canal?: CanalRetencion;

  @ApiProperty({ enum: TIPOS_INFORMACION, required: false })
  @IsOptional()
  @IsIn(TIPOS_INFORMACION)
  tipoInformacion?: TipoInformacion;
}

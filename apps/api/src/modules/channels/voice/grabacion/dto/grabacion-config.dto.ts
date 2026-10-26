import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** Roles del workspace que pueden habilitarse como acceso a la grabación. */
const ROLES_ACCESO = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;

/** Filtro de la consulta de configuración de grabación: la empresa es obligatoria. */
export class GrabacionConfigQueryDto {
  @ApiProperty({ description: 'Empresa (OrgUnit tipo EMPRESA) cuya configuración de grabación se consulta' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  empresaId!: string;
}

/**
 * Crea/actualiza (upsert) la configuración de grabación/retención de una empresa. Solo ADMIN+. TODO OFF/null por
 * defecto: los campos omitidos NO activan nada. No se declaran plazos legales ni valor probatorio: `retencionDias` es un
 * control técnico que, en null, queda "pendiente de política".
 */
export class PutGrabacionConfigDto {
  @ApiPropertyOptional({ description: 'Habilita marcar/persistir referencias de audio', default: false })
  @IsOptional()
  @IsBoolean()
  grabarAudio?: boolean;

  @ApiPropertyOptional({ description: 'Habilita persistir referencias de la transcripción', default: false })
  @IsOptional()
  @IsBoolean()
  guardarTranscripcion?: boolean;

  @ApiPropertyOptional({ description: 'Habilita persistir el resumen de la llamada', default: false })
  @IsOptional()
  @IsBoolean()
  guardarResumen?: boolean;

  @ApiPropertyOptional({ description: 'Habilita persistir evidencia asociada a la llamada', default: false })
  @IsOptional()
  @IsBoolean()
  guardarEvidencia?: boolean;

  @ApiPropertyOptional({ description: 'Exige autorización (cuando corresponda) antes de grabar', default: true })
  @IsOptional()
  @IsBoolean()
  requiereAutorizacion?: boolean;

  @ApiPropertyOptional({ description: 'Finalidad declarada del tratamiento (texto libre, sin declarar cumplimiento)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  finalidad?: string;

  @ApiPropertyOptional({
    description: 'Plazo de conservación en días. Omitir o null = pendiente de política (NO es un plazo por defecto)',
    nullable: true,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  retencionDias?: number | null;

  @ApiPropertyOptional({
    description: 'Roles del workspace que pueden acceder a la grabación',
    enum: ROLES_ACCESO,
    isArray: true,
    default: [],
  })
  @IsOptional()
  @IsIn(ROLES_ACCESO, { each: true })
  @ArrayUnique()
  accesoRoles?: string[];

  @ApiPropertyOptional({ description: 'Habilita la eliminación automática al vencer el plazo', default: false })
  @IsOptional()
  @IsBoolean()
  eliminacionAutomatica?: boolean;
}

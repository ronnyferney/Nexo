import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  API_KEY_EXPIRATIONS,
  API_KEY_ROLES,
  API_KEY_SCOPES,
  type ApiKeyExpiration,
  type ApiKeyRole,
  type ApiKeyScope,
} from '../../../common/guards/api-key-scopes';

/** Alta de una API key (B3): alcance obligatorio; rol y expiración con valores por defecto seguros. */
export class CreateApiKeyDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name!: string;

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true, description: 'Permisos de la clave (al menos uno)' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elija al menos un alcance' })
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true, message: `Alcance no válido; use: ${API_KEY_SCOPES.join(', ')}` })
  scopes!: ApiKeyScope[];

  @ApiPropertyOptional({ enum: API_KEY_ROLES, default: 'EDITOR', description: 'Rol máximo; no mayor que el suyo' })
  @IsOptional()
  @IsIn(API_KEY_ROLES, { message: `Rol no válido; use: ${API_KEY_ROLES.join(', ')}` })
  role?: ApiKeyRole;

  @ApiPropertyOptional({
    enum: API_KEY_EXPIRATIONS,
    default: '90d',
    description: '`never` (sin expiración) solo para un OWNER',
  })
  @IsOptional()
  @IsIn(API_KEY_EXPIRATIONS, { message: `Expiración no válida; use: ${API_KEY_EXPIRATIONS.join(', ')}` })
  expiration?: ApiKeyExpiration;
}

export class UpsertSecretDto {
  @ApiProperty({ description: 'Nombre referenciable como {{ secrets.NOMBRE }}' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/, { message: 'Use MAYUSCULAS_CON_GUIONES (ej. CRM_TOKEN)' })
  name!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(8192) value!: string;
}

/** Ajustes del workspace (ADR 0007). */
export class UpdateWorkspaceSettingsDto {
  @ApiPropertyOptional({ description: 'Permite que cualquier miembro cree agentes personales (PRIVATE)' })
  @IsOptional()
  @IsBoolean()
  allowPersonalAgents?: boolean;
}

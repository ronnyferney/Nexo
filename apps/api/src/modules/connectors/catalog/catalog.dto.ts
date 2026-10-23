import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { CatalogAuthMethod } from './catalog.types';

export const AUTH_METHODS: CatalogAuthMethod[] = ['apiKey', 'bearer', 'oauth2_code', 'mcp'];

export class InstallCatalogDto {
  @ApiPropertyOptional({ description: 'Nombre del conector (por defecto, el de la integración)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: AUTH_METHODS, description: 'Por defecto, el primer método de la integración' })
  @IsOptional()
  @IsIn(AUTH_METHODS)
  authMethod?: CatalogAuthMethod;

  @ApiPropertyOptional({ type: Object, description: 'Valores de los campos de credencial (se guardan en la bóveda)' })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ConnectProviderDto {
  @ApiPropertyOptional({ description: 'Nombre de la conexión (por defecto, el del proveedor)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiProperty({ description: 'Valores de los campos del catálogo (`fields[].key` → valor)', type: Object })
  @IsObject()
  fields!: Record<string, string>;

  @ApiPropertyOptional({ description: 'Ids de modelos a importar (por defecto, los sugeridos disponibles)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  models?: string[];
}

/** Datos opcionales de una conexión creada con inicio de sesión (OAuth o código de dispositivo). */
export class LlmFlowStartDto {
  @ApiPropertyOptional({ description: 'Nombre de la conexión (por defecto, el del proveedor)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    description: 'Campos no secretos del mecanismo (p. ej. `projectId` y `region` de Vertex AI)',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Ids de modelos a importar (por defecto, los sugeridos disponibles)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  models?: string[];
}

export class LlmOAuthStartDto extends LlmFlowStartDto {
  @ApiPropertyOptional({ description: 'Solo OpenRouter: límite de crédito (USD) de la clave que crea para Nexo' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100_000)
  limit?: number;
}

/** @deprecated Alias anterior de `LlmOAuthStartDto` (OpenRouter). */
export class OpenRouterOAuthStartDto extends LlmOAuthStartDto {}

export class DevicePollDto {
  @ApiProperty({ description: 'Id devuelto por `device/start`' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  flowId!: string;
}

export class DetectLocalDto {
  @ApiPropertyOptional({ description: 'URL base a probar (por defecto, la local del proveedor terminada en /v1)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  baseUrl?: string;
}

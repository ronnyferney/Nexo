import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
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

  @ApiPropertyOptional({
    description:
      'Mecanismo: `API_KEY` (por defecto, o la URL manual de los locales), `WORKLOAD_IDENTITY` (federación de identidad ' +
      'con la API de Anthropic) o `AWS_ROLE` (rol de IAM + ExternalId). Los dos últimos no guardan ningún secreto.',
    enum: ['API_KEY', 'WORKLOAD_IDENTITY', 'AWS_ROLE'],
  })
  @IsOptional()
  @IsIn(['API_KEY', 'WORKLOAD_IDENTITY', 'AWS_ROLE'])
  mechanism?: 'API_KEY' | 'WORKLOAD_IDENTITY' | 'AWS_ROLE';

  @ApiPropertyOptional({ description: 'Solo `AWS_ROLE`: comprobante del ExternalId devuelto por `keyless/prepare`' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  setupToken?: string;
}

/** `POST /admin/llm/providers/:id/keyless/prepare`: datos que el cliente necesita para configurar su lado. */
export class PrepareKeylessDto {
  @ApiProperty({ enum: ['WORKLOAD_IDENTITY', 'AWS_ROLE'] })
  @IsIn(['WORKLOAD_IDENTITY', 'AWS_ROLE'])
  mechanism!: 'WORKLOAD_IDENTITY' | 'AWS_ROLE';

  @ApiPropertyOptional({
    description: 'Campos no secretos ya escritos (p. ej. `region`, `workspaceId`) para concretar la política sugerida',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, string>;
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

  @ApiPropertyOptional({
    description:
      'Volver a iniciar sesión en una conexión OAuth existente: renueva sus tokens y conserva modelos y agentes',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  connectionId?: string;
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

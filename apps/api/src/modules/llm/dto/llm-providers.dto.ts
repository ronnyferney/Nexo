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

export class OpenRouterOAuthStartDto {
  @ApiPropertyOptional({ description: 'Límite de crédito (USD) de la clave que OpenRouter crea para Nexo' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100_000)
  limit?: number;
}

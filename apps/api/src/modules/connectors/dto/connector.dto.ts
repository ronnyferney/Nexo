import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ConnectorType } from '@prisma/client';
import { MAX_ALLOWED_SECRETS, SECRET_NAME_PATTERN } from '../domain/secret-refs';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateConnectorDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ enum: ConnectorType }) @IsEnum(ConnectorType) type!: ConnectorType;
  @ApiProperty({ type: Object }) @IsObject() config!: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() auth?: Record<string, unknown>;
}

export class UpdateConnectorDto extends PartialType(CreateConnectorDto) {}

export class CreateOperationDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,64}$/) key!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() inputSchema?: Record<string, unknown>;
  @ApiProperty({ type: Object }) @IsObject() definition!: Record<string, unknown>;
}

export class UpdateOperationDto extends PartialType(CreateOperationDto) {}

export class InvokeOperationDto {
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() input?: Record<string, unknown>;
}

/** `POST /connectors/:id/discover`: en conectores DATABASE, tablas (`tabla` o `esquema.tabla`) a importar. */
export class DiscoverConnectorDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  tables?: string[];
}

/** `PUT /connectors/:id/allowed-secrets` (ADMIN): nombres de la bóveda que el conector puede resolver (A4). */
export class SetAllowedSecretsDto {
  @ApiProperty({ type: [String], example: ['CRM_TOKEN'] })
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_SECRETS)
  @IsString({ each: true })
  @Matches(SECRET_NAME_PATTERN, { each: true, message: 'Nombres de secreto en MAYUSCULAS_CON_GUIONES (ej. CRM_TOKEN)' })
  names!: string[];
}

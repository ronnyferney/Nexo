import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ConnectorType } from '@prisma/client';
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

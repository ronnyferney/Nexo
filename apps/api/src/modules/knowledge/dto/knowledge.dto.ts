import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateKnowledgeBaseDto extends PartialType(CreateKnowledgeBaseDto) {}

/** `{ title, text }` (texto) o `{ title?, url }` (página web). */
export class CreateDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional({ description: 'Contenido en texto plano o markdown' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5_000_000)
  text?: string;
  @ApiPropertyOptional({ description: 'URL http(s) de la que se extrae el texto' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2000)
  url?: string;
}

export class UploadDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
}

export class SearchKnowledgeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) query!: string;
  @ApiPropertyOptional({ default: 5 }) @IsOptional() @IsInt() @Min(1) @Max(20) limit?: number;
}

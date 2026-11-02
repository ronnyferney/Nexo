import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de un perfil de contacto/persona (ADR 0018 Inc.1). Es CONTEXTO, no concede permisos y no admite secretos.
 * El `workspaceId` NUNCA llega en el cuerpo: se toma de `@CurrentAuth()`. La PII (`correos`/`telefonos`) se guarda en
 * claro en Inc.1; el cifrado de campo y la purga por retención quedan para un incremento posterior (ADR 0008).
 */
export class CreateContactoDto {
  @ApiProperty({ description: 'Nombre de la persona' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  nombre!: string;

  @ApiPropertyOptional({ description: 'Correo principal (único por workspace)' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  correoPrincipal?: string;

  @ApiPropertyOptional({ type: [String], description: 'Correos conocidos del contacto' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  @MaxLength(320, { each: true })
  correos?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Teléfonos conocidos del contacto' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  telefonos?: string[];

  @ApiPropertyOptional({ description: 'Idioma preferido (p. ej. es, en)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  idioma?: string;

  @ApiPropertyOptional({ description: 'Tono preferido para dirigirse al contacto' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tono?: string;

  @ApiPropertyOptional({ description: 'Organización vinculada (debe pertenecer al mismo workspace)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  organizacionId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Señales derivadas con evidencia (p. ej. puntualidad de pago)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  senales?: string[];

  @ApiPropertyOptional({ description: 'Procedencia del dato (p. ej. correo, carga manual)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fuente?: string;
}

/** Edición parcial del perfil de contacto; todos los campos opcionales en PATCH. */
export class UpdateContactoDto extends PartialType(CreateContactoDto) {}

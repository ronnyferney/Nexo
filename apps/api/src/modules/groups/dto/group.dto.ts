import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const GROUP_MAX_MEMBERS = 500;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGroupDto {
  @ApiProperty({ minLength: 2, maxLength: 80, example: 'Gerentes de línea' })
  @Transform(trim)
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(80, { message: 'El nombre admite como máximo 80 caracteres' })
  name!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'La descripción debe ser texto' })
  @MaxLength(300, { message: 'La descripción admite como máximo 300 caracteres' })
  description?: string;

  @ApiPropertyOptional({ type: [String], maxItems: GROUP_MAX_MEMBERS, description: 'Ids de miembros del workspace' })
  @IsOptional()
  @IsArray({ message: 'userIds debe ser una lista' })
  @ArrayMaxSize(GROUP_MAX_MEMBERS, { message: `Un grupo admite como máximo ${GROUP_MAX_MEMBERS} miembros` })
  @IsString({ each: true, message: 'Cada userId debe ser texto' })
  userIds?: string[];
}

export class UpdateGroupDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 80 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'El nombre debe ser texto' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(80, { message: 'El nombre admite como máximo 80 caracteres' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 300, nullable: true, description: 'Cadena vacía o null la elimina' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'La descripción debe ser texto' })
  @MaxLength(300, { message: 'La descripción admite como máximo 300 caracteres' })
  description?: string | null;
}

export class SetGroupMembersDto {
  @ApiProperty({ type: [String], maxItems: GROUP_MAX_MEMBERS, description: 'Reemplaza a todos los miembros' })
  @IsArray({ message: 'userIds debe ser una lista' })
  @ArrayMaxSize(GROUP_MAX_MEMBERS, { message: `Un grupo admite como máximo ${GROUP_MAX_MEMBERS} miembros` })
  @IsString({ each: true, message: 'Cada userId debe ser texto' })
  userIds!: string[];
}

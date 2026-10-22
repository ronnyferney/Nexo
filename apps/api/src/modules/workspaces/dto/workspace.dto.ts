import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name!: string;
}

export class UpsertSecretDto {
  @ApiProperty({ description: 'Nombre referenciable como {{ secrets.NOMBRE }}' })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/, { message: 'Use MAYUSCULAS_CON_GUIONES (ej. CRM_TOKEN)' })
  name!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(8192) value!: string;
}

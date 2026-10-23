import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateBy } from 'class-validator';
import { isValidCron, isValidTimezone } from '../cron.util';

const IsCron = () =>
  ValidateBy({
    name: 'isCron',
    validator: {
      validate: (v) => isValidCron(v),
      defaultMessage: () => 'Cron inválido: use 5 campos (min hora día mes díaSemana), ej. "0 8 * * 1-5"',
    },
  });

const IsTimezone = () =>
  ValidateBy({
    name: 'isTimezone',
    validator: {
      validate: (v) => isValidTimezone(v),
      defaultMessage: () => 'Zona horaria inválida: use un nombre IANA, ej. "America/Bogota" o "UTC"',
    },
  });

export class CreateRoutineDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty({ description: 'Instrucción que recibe el agente en cada corrida' })
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  prompt!: string;
  @ApiProperty({ description: 'Cron de 5 campos, ej. "0 8 * * 1-5"' }) @IsString() @IsCron() schedule!: string;
  @ApiPropertyOptional({ description: 'Zona horaria IANA (por defecto UTC)' })
  @IsOptional()
  @IsString()
  @IsTimezone()
  timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'URL que recibe un POST al terminar cada corrida' })
  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'], require_tld: false },
    { message: 'URL de notificación inválida' },
  )
  @MaxLength(2000)
  notifyWebhookUrl?: string | null;
}

export class UpdateRoutineDto extends PartialType(CreateRoutineDto) {}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { WorkflowDefinition } from '../engine/workflow.types';

export class CreateWorkflowDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() definition?: WorkflowDefinition;
  @ApiPropertyOptional({ description: 'Cron de 5 campos, ej. "0 8 * * 1-5"' })
  @IsOptional()
  @IsString()
  @Matches(/^(\S+\s+){4}\S+$/, { message: 'Cron inválido: use 5 campos (min hora día mes díaSemana)' })
  schedule?: string | null;
}

export class UpdateWorkflowDto extends PartialType(CreateWorkflowDto) {}

export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class RunWorkflowDto {
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() input?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Esperar el resultado (máx. 60 s)' }) @IsOptional() @IsBoolean() wait?: boolean;
}

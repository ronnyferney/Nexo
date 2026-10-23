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

export class UpdateWorkflowDto extends PartialType(CreateWorkflowDto) {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Flujo del mismo workspace que se dispara cuando una ejecución falla (null para quitarlo)',
  })
  @IsOptional()
  @IsString()
  errorWorkflowId?: string | null;
}

export class TestNodeDto {
  @ApiPropertyOptional({ type: Object, description: 'Entrada del flujo ({{ input }})' })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object, description: 'Salidas fijadas por nodo: { nodeId: salida }' })
  @IsOptional()
  @IsObject()
  pinned?: Record<string, unknown>;
}

export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class RunWorkflowDto {
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() input?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Esperar el resultado (máx. 60 s)' }) @IsOptional() @IsBoolean() wait?: boolean;
}

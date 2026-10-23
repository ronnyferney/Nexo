import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSkillDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty({ description: 'Cuándo usar la habilidad (va en el prompt del agente)' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;
  @ApiProperty({ description: 'Instrucciones completas en markdown (se cargan con load_skill)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  instructions!: string;
  @ApiPropertyOptional({ description: 'Operaciones de conector que la habilidad aporta como herramientas' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  operationIds?: string[];
}

export class UpdateSkillDto extends PartialType(CreateSkillDto) {}

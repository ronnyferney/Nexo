import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEdgeDto {
  @ApiProperty({ example: 'Sede principal' }) @IsString() @MinLength(2) @MaxLength(80) name!: string;
}

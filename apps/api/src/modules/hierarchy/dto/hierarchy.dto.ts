import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Fija o cambia a quién reporta un agente (E3). `null` = quitar supervisor (deja al agente como raíz del organigrama).
 * El `agentId` cuyo supervisor se fija viaja en la ruta; aquí solo va el supervisor destino.
 */
export class SetSupervisorDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Agente al que reportará (su supervisor directo); null para quitarlo / dejarlo como raíz',
  })
  @ValidateIf((o: SetSupervisorDto) => o.reportaAAgentId !== null && o.reportaAAgentId !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reportaAAgentId!: string | null;
}

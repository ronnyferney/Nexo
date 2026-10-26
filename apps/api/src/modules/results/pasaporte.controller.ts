import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { PasaporteService } from './pasaporte.service';

/**
 * Emisión del pasaporte de resultado (ADR 0014 · E14). Vive bajo `contracts/:id` porque el pasaporte se emite PARA un
 * `ContratoResultado` ACEPTADO. Mutación -> `@MinRole('EDITOR')` (igual que validar/avanzar un contrato en E4: emitir la
 * hoja de vida es un acto de gobierno de quien edita el trabajo, no de un mero lector). `workspaceId` de `@CurrentAuth`.
 */
@ApiTags('pasaportes-resultado')
@ApiBearerAuth()
@Controller('contracts')
export class ContractPassportController {
  constructor(private readonly pasaportes: PasaporteService) {}

  @MinRole('EDITOR')
  @Post(':id/passport')
  emitir(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.pasaportes.emitir(a, id);
  }

  /**
   * Lista los pasaportes del contrato, el más reciente primero (append-only: la reemisión encadena con `reemplazaAId`).
   * Solo lectura -> `@MinRole('VIEWER')`, coherente con la lectura de pasaportes. `workspaceId` de `@CurrentAuth`; el
   * aislamiento multi-tenant hace que un contrato de otro workspace responda 404. Devuelve `[]` si aún no hay ninguno.
   */
  @MinRole('VIEWER')
  @Get(':id/passports')
  listarPorContrato(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.pasaportes.listarPorContrato(a.workspaceId, id);
  }
}

/**
 * Lectura, verificación y exportación del pasaporte. Solo lectura: no hay mutaciones (append-only). Legible por
 * `VIEWER`+ con alcance al recurso (todo filtra por `workspaceId` de `@CurrentAuth`): un tercero/auditor con rol de
 * lectura puede verificar y exportar la hoja de vida sin acceder a los datos sensibles subyacentes (solo referencias +
 * hashes). El aislamiento multi-tenant hace que un pasaporte de otro workspace responda 404.
 */
@ApiTags('pasaportes-resultado')
@ApiBearerAuth()
@Controller('passports')
export class PassportsController {
  constructor(private readonly pasaportes: PasaporteService) {}

  @Get(':id/verify')
  verify(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.pasaportes.verify(a.workspaceId, id);
  }

  @Get(':id/export')
  export(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.pasaportes.export(a.workspaceId, id);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.pasaportes.get(a.workspaceId, id);
  }
}

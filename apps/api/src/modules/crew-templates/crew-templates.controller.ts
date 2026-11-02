import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CrewTemplatesService } from './crew-templates.service';
import { InstallCrewTemplateDto, PublishCrewTemplateDto } from './dto/crew-template.dto';

/**
 * Agent Hub · plantillas de CUADRILLA (ADR 0019 · Inc.3). Descubrir (cualquier miembro, filtrado por `workspaceId`).
 * Publicar/instalar: `@MinRole('EDITOR')` —lo opera una persona (ADR 0016; nunca un agente)—; además el servicio exige
 * un humano identificado. `workspaceId` siempre de `@CurrentAuth`, nunca del cuerpo (aislamiento estricto).
 */
@ApiTags('crew-templates')
@ApiBearerAuth()
@Controller('crew-templates')
export class CrewTemplatesController {
  constructor(private readonly templates: CrewTemplatesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.templates.list(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post('publish')
  publish(@CurrentAuth() a: AuthContext, @Body() dto: PublishCrewTemplateDto) {
    return this.templates.publish(a, dto);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.templates.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/install')
  install(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: InstallCrewTemplateDto) {
    return this.templates.install(a, id, dto);
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { InstallCatalogDto } from './catalog.dto';
import { CatalogService } from './catalog.service';

/** Catálogo de conectores nativos (ADR 0005, D2). */
@ApiTags('connector-catalog')
@ApiBearerAuth()
@Controller('connector-catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.catalog.list(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post('starter-kit/commercial')
  commercialKit(@CurrentAuth() a: AuthContext) {
    return this.catalog.installCommercialKit(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post(':id/install')
  install(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: InstallCatalogDto) {
    return this.catalog.install(a, id, dto);
  }
}

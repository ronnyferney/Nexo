import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateEdgeDto } from './dto/edge.dto';
import { EdgeService } from './edge.service';

/** Selector de Edges para cualquier rol (configurar conectores DATABASE en modo edge). */
@ApiTags('edge')
@ApiBearerAuth()
@Controller('edges')
export class EdgeController {
  constructor(private readonly edges: EdgeService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.edges.options(a.workspaceId);
  }
}

/** Administración de agentes Nexo Edge (ADMIN+). El token se muestra una sola vez. */
@ApiTags('admin-edge')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/edges')
export class EdgeAdminController {
  constructor(private readonly edges: EdgeService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.edges.list(a.workspaceId);
  }

  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateEdgeDto) {
    return this.edges.create(a.workspaceId, dto.name);
  }

  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.edges.remove(a.workspaceId, id);
  }

  @HttpCode(200)
  @Post(':id/rotate-token')
  rotate(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.edges.rotateToken(a.workspaceId, id);
  }
}

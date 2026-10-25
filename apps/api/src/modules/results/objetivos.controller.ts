import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateObjetivoDto, UpdateObjetivoDto } from './dto/objetivo.dto';
import { ObjetivosService } from './objetivos.service';

/** Objetivos (E4 · RF07). Lectura para cualquier miembro; las mutaciones requieren EDITOR+. */
@ApiTags('objetivos')
@ApiBearerAuth()
@Controller('objetivos')
export class ObjetivosController {
  constructor(private readonly objetivos: ObjetivosService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.objetivos.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.objetivos.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateObjetivoDto) {
    return this.objetivos.create(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateObjetivoDto) {
    return this.objetivos.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.objetivos.remove(a.workspaceId, id);
  }
}

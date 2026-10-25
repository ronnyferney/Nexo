import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CargosService } from './cargos.service';
import { CreateCargoDto, UpdateCargoDto } from './dto/cargo.dto';

/** Catálogo de cargos (RF03). Lectura para cualquier miembro; las mutaciones requieren EDITOR+. */
@ApiTags('cargos')
@ApiBearerAuth()
@Controller('cargos')
export class CargosController {
  constructor(private readonly cargos: CargosService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.cargos.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.cargos.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateCargoDto) {
    return this.cargos.create(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateCargoDto) {
    return this.cargos.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.cargos.remove(a.workspaceId, id);
  }
}

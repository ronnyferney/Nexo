import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CommunityService } from './community.service';
import {
  ActualizarPublicacionDto,
  CrearComentarioDto,
  CrearPublicacionDto,
  CrearReaccionDto,
  ListarPublicacionesQueryDto,
} from './dto/publicacion.dto';

/**
 * Comunidad interna (E11): el "muro" corporativo privado. Leer, publicar, comentar y reaccionar son participación
 * normal → VIEWER+ (todo miembro del workspace). El autor SIEMPRE es `@CurrentAuth().userId`, nunca del cuerpo. Editar
 * o archivar una publicación lo decide el servicio (autor o ADMIN+). Todo filtra por `workspaceId` (multi-tenant).
 */
@ApiTags('comunidad')
@ApiBearerAuth()
@Controller('comunidad')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @MinRole('VIEWER')
  @Get('publicaciones')
  listPublicaciones(@CurrentAuth() a: AuthContext, @Query() query: ListarPublicacionesQueryDto) {
    return this.community.listPublicaciones(a.workspaceId, query);
  }

  @MinRole('VIEWER')
  @Post('publicaciones')
  crearPublicacion(@CurrentAuth() a: AuthContext, @Body() dto: CrearPublicacionDto) {
    return this.community.crearPublicacion(a.workspaceId, a, dto);
  }

  @MinRole('VIEWER')
  @Get('publicaciones/:id')
  getPublicacion(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.community.getPublicacion(a.workspaceId, id);
  }

  @MinRole('VIEWER')
  @Patch('publicaciones/:id')
  actualizarPublicacion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ActualizarPublicacionDto) {
    return this.community.actualizarPublicacion(a.workspaceId, id, a, dto);
  }

  @MinRole('VIEWER')
  @Delete('publicaciones/:id')
  eliminarPublicacion(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.community.eliminarPublicacion(a.workspaceId, id, a);
  }

  @MinRole('VIEWER')
  @Get('publicaciones/:id/comentarios')
  listComentarios(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.community.listComentarios(a.workspaceId, id);
  }

  @MinRole('VIEWER')
  @Post('publicaciones/:id/comentarios')
  comentar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearComentarioDto) {
    return this.community.comentar(a.workspaceId, id, a, dto);
  }

  @MinRole('VIEWER')
  @Post('publicaciones/:id/reacciones')
  reaccionar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearReaccionDto) {
    return this.community.reaccionar(a.workspaceId, id, a, dto);
  }

  @MinRole('VIEWER')
  @Delete('publicaciones/:id/reacciones/:tipo')
  quitarReaccion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('tipo') tipo: string) {
    return this.community.quitarReaccion(a.workspaceId, id, a, tipo);
  }
}

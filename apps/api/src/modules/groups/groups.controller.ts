import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateGroupDto, SetGroupMembersDto, UpdateGroupDto } from './dto/group.dto';
import { GroupsService } from './groups.service';

/** Grupos para el diálogo de compartir agentes (EDITOR+ con sesión de usuario). */
@ApiTags('groups')
@ApiBearerAuth()
@MinRole('EDITOR')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Grupos del workspace (id, nombre, descripción y número de miembros), por nombre' })
  list(@CurrentAuth() a: AuthContext) {
    if (a.via !== 'jwt') throw new ForbiddenException('Los grupos solo están disponibles con sesión de usuario');
    return this.groups.summaries(a.workspaceId);
  }
}

/** Administración de grupos de usuarios (ADR 0007 D6): ADMIN/OWNER. */
@ApiTags('admin-groups')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/groups')
export class GroupsAdminController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Grupos con sus miembros, por nombre' })
  list(@CurrentAuth() a: AuthContext) {
    return this.groups.list(a.workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un grupo (nombre único en el workspace) con miembros opcionales' })
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateGroupDto) {
    return this.groups.create(a.workspaceId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombra el grupo o cambia su descripción' })
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(a.workspaceId, id, dto);
  }

  @Put(':id/members')
  @ApiOperation({ summary: 'Reemplaza los miembros del grupo (aplica de inmediato a los agentes compartidos)' })
  setMembers(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetGroupMembersDto) {
    return this.groups.setMembers(a.workspaceId, id, dto.userIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Elimina el grupo y los shares de agentes dirigidos a él' })
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.groups.remove(a.workspaceId, id);
  }
}

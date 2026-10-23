import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateSkillDto, UpdateSkillDto } from './dto/skill.dto';
import { SkillsService } from './skills.service';

@ApiTags('skills')
@ApiBearerAuth()
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.skills.list(a.workspaceId);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateSkillDto) {
    return this.skills.create(a.workspaceId, dto);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.skills.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.skills.remove(a.workspaceId, id);
  }
}

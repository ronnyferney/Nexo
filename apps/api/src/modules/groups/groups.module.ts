import { Module } from '@nestjs/common';
import { GroupsAdminController, GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

/** Grupos de usuarios para publicar agentes a una audiencia transversal a las unidades (ADR 0007 D6). */
@Module({
  controllers: [GroupsController, GroupsAdminController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}

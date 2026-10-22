import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { WorkspacesController } from './workspaces.controller';

@Global()
@Module({ controllers: [WorkspacesController], providers: [SecretsService], exports: [SecretsService] })
export class WorkspacesModule {}

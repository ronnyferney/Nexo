import { Global, Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { SecretsService } from './secrets.service';
import { WorkspacesController } from './workspaces.controller';

@Global()
@Module({
  controllers: [WorkspacesController],
  providers: [SecretsService, ApiKeysService],
  exports: [SecretsService, ApiKeysService],
})
export class WorkspacesModule {}

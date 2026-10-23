import { Module } from '@nestjs/common';
import { EdgeModule } from '../edge/edge.module';
import { OAuthModule } from '../oauth/oauth.module';
import { SkillsModule } from '../skills/skills.module';
import { AuthResolverService } from './adapters/auth-resolver.service';
import { DatabaseAdapter } from './adapters/database/database.adapter';
import { GraphqlAdapter } from './adapters/graphql.adapter';
import { McpAdapter } from './adapters/mcp.adapter';
import { RestAdapter } from './adapters/rest.adapter';
import { SoapAdapter } from './adapters/soap.adapter';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { CONNECTOR_ADAPTERS } from './domain/connector-adapter';

const ADAPTERS = [RestAdapter, SoapAdapter, GraphqlAdapter, McpAdapter, DatabaseAdapter];

@Module({
  imports: [EdgeModule, OAuthModule, SkillsModule],
  controllers: [ConnectorsController, CatalogController],
  providers: [
    AuthResolverService,
    ConnectorsService,
    CatalogService,
    ...ADAPTERS,
    { provide: CONNECTOR_ADAPTERS, useFactory: (...a: unknown[]) => a, inject: ADAPTERS },
  ],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}

import { Module } from '@nestjs/common';
import { AuthResolverService } from './adapters/auth-resolver.service';
import { GraphqlAdapter } from './adapters/graphql.adapter';
import { McpAdapter } from './adapters/mcp.adapter';
import { RestAdapter } from './adapters/rest.adapter';
import { SoapAdapter } from './adapters/soap.adapter';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';
import { CONNECTOR_ADAPTERS } from './domain/connector-adapter';

const ADAPTERS = [RestAdapter, SoapAdapter, GraphqlAdapter, McpAdapter];

@Module({
  controllers: [ConnectorsController],
  providers: [
    AuthResolverService,
    ConnectorsService,
    ...ADAPTERS,
    { provide: CONNECTOR_ADAPTERS, useFactory: (...a: unknown[]) => a, inject: ADAPTERS },
  ],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}

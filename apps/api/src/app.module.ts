import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { CryptoModule } from './common/crypto/crypto.module';
import { redactUrl } from './common/logging/redact-url';
import { HttpClientModule } from './common/http/http-client.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { MailModule } from './infrastructure/mail/mail.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisThrottlerStorage } from './infrastructure/throttler/redis-throttler.storage';
import { ThrottlerStorageModule } from './infrastructure/throttler/throttler-storage.module';
import { AgentAccessModule } from './modules/agent-access/agent-access.module';
import { AgentsModule } from './modules/agents/agents.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { EdgeModule } from './modules/edge/edge.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { GroupsModule } from './modules/groups/groups.module';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { McpServerModule } from './modules/mcp-server/mcp-server.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { RoutinesModule } from './modules/routines/routines.module';
import { SkillsModule } from './modules/skills/skills.module';
import { TrainingModule } from './modules/training/training.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        serializers: {
          // Sin el token de los webhooks ni `code`/`state` de los callbacks OAuth (B1).
          req: (req: { id: unknown; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: redactUrl(req.url),
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    // Límite general por IP real del cliente (`TRUST_PROXY`) con contadores compartidos en Redis entre réplicas.
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 300 }],
        storage,
        errorMessage: 'Demasiadas solicitudes; intente de nuevo en unos minutos',
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ connection: config.getOrThrow('redis') }),
    }),
    PrismaModule,
    MailModule,
    CryptoModule,
    HttpClientModule,
    AuthModule,
    WorkspacesModule,
    LlmModule,
    GovernanceModule,
    GroupsModule,
    ConnectorsModule,
    OAuthModule,
    EdgeModule,
    AgentAccessModule,
    AgentsModule,
    CopilotModule,
    SkillsModule,
    KnowledgeModule,
    TrainingModule,
    WorkflowsModule,
    RoutinesModule,
    McpServerModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

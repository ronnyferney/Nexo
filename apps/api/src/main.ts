import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { TrustProxy } from './config/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));
  // IP real del cliente detrás de ALB → nginx (A5): sin esto, el limitador ve a todos los clientes con la IP del proxy.
  app.set('trust proxy', config.getOrThrow<TrustProxy>('trustProxy'));
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // Swagger solo fuera de producción, o con SWAGGER_ENABLED=true explícito (B10).
  if (config.get<boolean>('swaggerEnabled')) {
    const doc = new DocumentBuilder()
      .setTitle('Nexo API')
      .setDescription('Plataforma de agentes de IA, conectores (REST, SOAP, GraphQL, MCP) y flujos de automatización')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addCookieAuth('nexo_session')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();

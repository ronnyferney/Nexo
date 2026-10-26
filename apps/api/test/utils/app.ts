import { getSharedConfigToken } from '@nestjs/bullmq';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getStorageToken, type ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import type { TrustProxy } from '../../src/config/trust-proxy';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { RedisThrottlerStorage } from '../../src/infrastructure/throttler/redis-throttler.storage';

/** Base Redis dedicada a la suite: aísla la cola de flujos de cualquier API/worker local que use la base 0. */
export const E2E_REDIS_DB = Number(process.env.E2E_REDIS_DB ?? 7);

/**
 * Sin límite de peticiones: cada archivo registra decenas de usuarios desde 127.0.0.1 y el límite de
 * /auth/register (10/min) haría fallar la suite. El throttling se prueba aparte, no aquí.
 */
const noThrottle: ThrottlerStorage = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** Redis de la suite (misma base que la cola de flujos de las pruebas). */
function e2eRedis() {
  return {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    db: E2E_REDIS_DB,
  };
}

/**
 * Arranca la app Nest real con la misma configuración HTTP que `src/main.ts`. Con `throttle: true` el limitador usa
 * el almacenamiento real en Redis (base de la suite) en vez de desactivarse: lo usan las pruebas del limitador.
 */
export async function createTestApp(opts: { throttle?: boolean } = {}): Promise<INestApplication> {
  const storage = opts.throttle
    ? new RedisThrottlerStorage({ getOrThrow: () => e2eRedis() } as unknown as ConfigService)
    : noThrottle;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getStorageToken())
    .useValue(storage)
    .overrideProvider(getSharedConfigToken())
    .useValue({ connection: e2eRedis() })
    .compile();
  // `rawBody: true` como en `main.ts`: expone `req.rawBody` para la firma HMAC de los webhooks de canales (E14).
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], rawBody: true });
  app.set('trust proxy', app.get(ConfigService).getOrThrow<TrustProxy>('trustProxy'));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Cookie de ligadura del inicio de sesión OAuth de proveedores IA (M1) que recibió el «navegador» de la prueba al
 * iniciar el flujo; el callback debe presentarla, como haría el navegador real.
 */
let llmOAuthCookieValue = '';
export function llmOAuthCookie(): string {
  return llmOAuthCookieValue;
}

/** Cliente HTTP autenticado contra la app (rutas sin el prefijo `/api`). */
export class Api {
  constructor(
    private readonly app: INestApplication,
    readonly token?: string,
  ) {}

  call(method: Method, path: string): request.Test {
    const req = request(this.app.getHttpServer())[method](`/api${path}`);
    req.on('response', (res: { headers: Record<string, unknown> }) => {
      const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
      const binding = cookies.find((c) => c.startsWith('nexo_llm_oauth=') && !c.startsWith('nexo_llm_oauth=;'));
      if (binding) llmOAuthCookieValue = binding.split(';')[0];
    });
    return this.token ? req.set('Authorization', `Bearer ${this.token}`) : req;
  }

  get(path: string) {
    return this.call('get', path);
  }
  post(path: string, body?: object) {
    return this.call('post', path).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.call('put', path).send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.call('patch', path).send(body ?? {});
  }
  delete(path: string) {
    return this.call('delete', path);
  }

  /** POST que responde text/event-stream: devuelve los eventos ya parseados. */
  async sse(path: string, body: object): Promise<{ status: number; events: SseEvent[] }> {
    const res = await this.call('post', path)
      .send(body)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (chunk: string) => (data += chunk));
        r.on('end', () => cb(null, data));
      });
    return { status: res.status, events: parseSse(res.body as string) };
  }
}

export interface SseEvent {
  event: string;
  data: any;
}

export function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      const raw = data.join('\n');
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // texto plano
      }
      return { event, data: parsed };
    });
}

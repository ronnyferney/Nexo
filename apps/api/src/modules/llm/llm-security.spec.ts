import type { ConfigService } from '@nestjs/config';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { HttpClientService } from '../../common/http/http-client.service';
import configuration from '../../config/configuration';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { fallbackModel } from '../copilot/copilot-proposals.service';
import { AnthropicDriver } from './drivers/anthropic.driver';
import { assertSafeDestinationChange } from './llm-admin.controller';
import { ConnectionUnavailableException } from './llm-errors';
import { LlmGatewayService } from './llm-gateway.service';
import type { AwsRoleService } from './keyless/aws-role.service';
import type { OidcIssuerService } from './keyless/oidc-issuer.service';
import type { LlmTokenService } from './llm-token.service';

describe('A2 · las credenciales no se redirigen a otro destino', () => {
  const catalog = {
    providerId: 'claude-foundry',
    credentialType: 'API_KEY' as const,
    baseUrl: 'https://r.services.ai.azure.com/anthropic',
    kind: 'ANTHROPIC' as const,
  };
  const manual = {
    providerId: null,
    credentialType: 'API_KEY' as const,
    baseUrl: 'https://llm.empresa.com/v1',
    kind: 'OPENAI_COMPATIBLE' as const,
  };
  const oauth = {
    providerId: 'vertex',
    credentialType: 'OAUTH' as const,
    baseUrl: 'https://aiplatform.googleapis.com',
    kind: 'OPENAI_COMPATIBLE' as const,
  };

  it('una conexión del catálogo o con inicio de sesión no cambia de URL ni de tipo', () => {
    expect(() => assertSafeDestinationChange(catalog, { baseUrl: 'https://atacante.example.com' })).toThrow(
      /no se pueden cambiar/,
    );
    expect(() => assertSafeDestinationChange(catalog, { kind: 'OPENAI_COMPATIBLE', apiKey: 'k' })).toThrow(
      /no se pueden cambiar/,
    );
    expect(() =>
      assertSafeDestinationChange(oauth, { baseUrl: 'https://atacante.example.com', apiKey: 'k' }),
    ).toThrow();
  });

  it('una conexión manual cambia de destino solo con la clave nueva en la misma petición', () => {
    expect(() => assertSafeDestinationChange(manual, { baseUrl: 'https://otro.example.com/v1' })).toThrow(
      /ingrese de nuevo la clave/,
    );
    expect(() =>
      assertSafeDestinationChange(manual, { baseUrl: 'https://otro.example.com/v1', apiKey: 'nueva' }),
    ).not.toThrow();
  });

  it('cambios sin destino nuevo pasan; una conexión OAuth no acepta clave de API', () => {
    expect(() => assertSafeDestinationChange(catalog, { name: 'Otro nombre', enabled: false })).not.toThrow();
    expect(() => assertSafeDestinationChange(catalog, { baseUrl: catalog.baseUrl })).not.toThrow();
    expect(() => assertSafeDestinationChange(oauth, { apiKey: 'sk-falsa' })).toThrow(/inicio de sesión/);
  });
});

describe('A6 · cupo mensual de la conexión de plataforma', () => {
  function gateway(used: number, cfg: Record<string, unknown>) {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { costUsd: used } });
    const prisma = {
      usageRecord: { aggregate },
      llmConnection: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const config = {
      get: (k: string) => ({ 'llm.anthropicApiKey': 'sk-ant-plataforma', ...cfg })[k],
    } as unknown as ConfigService;
    const g = new LlmGatewayService(
      prisma,
      {} as CryptoService,
      config,
      [new AnthropicDriver({ safeFetch: () => fetch } as unknown as HttpClientService)],
      {} as LlmTokenService,
      {} as OidcIssuerService,
      {} as AwsRoleService,
    );
    return { g, aggregate };
  }

  it('dentro del cupo resuelve; agotado, la conexión queda no disponible (y activa el respaldo)', async () => {
    await expect(
      gateway(1, { 'llm.platformMonthlyUsd': 5 }).g.resolve('ws1', 'anthropic', 'claude-opus-5-5'),
    ).resolves.toMatchObject({ providerId: 'anthropic' });
    const err = await gateway(5, { 'llm.platformMonthlyUsd': 5 })
      .g.resolve('ws1', 'anthropic', 'claude-opus-5-5')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionUnavailableException);
    expect((err as Error).message).toMatch(/cupo mensual/);
  });

  it('el cupo cuenta solo el consumo de la plataforma de este mes, sin el Copilot', async () => {
    const { g, aggregate } = gateway(0, { 'llm.platformMonthlyUsd': 5 });
    await g.resolve('ws1', 'anthropic', 'claude-opus-5-5');
    expect(aggregate.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'ws1',
      providerId: 'anthropic',
      source: { not: 'COPILOT' },
    });
  });

  it('cupo 0 deshabilita la conexión (y el catálogo la marca no configurada); los workspaces exentos no tienen tope', async () => {
    const off = gateway(0, { 'llm.platformMonthlyUsd': 0 }).g;
    await expect(off.resolve('ws1', 'anthropic', 'claude-opus-5-5')).rejects.toThrow(/no está habilitado/);
    expect((await off.catalog('ws1')).find((c) => c.id === 'anthropic')?.configured).toBe(false);
    const exempt = gateway(999, { 'llm.platformMonthlyUsd': 5, 'llm.platformUnlimitedWorkspaces': ['ws1'] }).g;
    await expect(exempt.resolve('ws1', 'anthropic', 'claude-opus-5-5')).resolves.toBeTruthy();
    // El Copilot tiene su propio cupo.
    await expect(off.resolve('ws1', 'anthropic', 'claude-opus-5-5', { platformQuota: false })).resolves.toBeTruthy();
  });
});

describe('B9 · el Copilot nunca guarda un modelo fuera del workspace', () => {
  it('elige Claude Opus 5.5 disponible, luego otro modelo real y el simulado al final', () => {
    expect(fallbackModel(new Set(['mock:mock-echo', 'c1:claude-sonnet-5-5', 'c1:claude-opus-5-5']))).toEqual({
      provider: 'c1',
      model: 'claude-opus-5-5',
    });
    expect(fallbackModel(new Set(['mock:mock-echo', 'c2:gpt-x']))).toEqual({ provider: 'c2', model: 'gpt-x' });
    expect(fallbackModel(new Set(['mock:mock-echo']))).toEqual({ provider: 'mock', model: 'mock-echo' });
    expect(fallbackModel(new Set(['ollama:llama3:8b']))).toEqual({ provider: 'ollama', model: 'llama3:8b' });
    expect(fallbackModel(new Set())).toBeNull();
  });
});

describe('I1 · el simulador solo existe en desarrollo o pruebas explícitos', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it.each([
    ['production', false],
    ['', false],
    ['staging', false],
    ['development', true],
    ['test', true],
  ])('NODE_ENV=%p → %p', (env, expected) => {
    process.env.LLM_DEV_SIMULATOR = 'true';
    if (env) process.env.NODE_ENV = env;
    else delete process.env.NODE_ENV;
    expect(configuration().llm.devSimulator).toBe(expected);
  });
});

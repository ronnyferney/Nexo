import type { ConfigService } from '@nestjs/config';
import type { HttpClientService } from '../../../common/http/http-client.service';
import { AwsRoleService } from './aws-role.service';
import { KeylessAuthError } from './keyless-errors';
import { EXTERNAL_ID_PATTERN, type AwsRoleOptions } from './keyless-options';

const ROLE: AwsRoleOptions = {
  type: 'AWS_ROLE',
  roleArn: 'arn:aws:iam::123456789012:role/nexo-claude',
  externalId: `nexo-${'a'.repeat(32)}`,
  region: 'us-east-1',
};

function stsXml(expiresInMs: number, n: number) {
  return (
    '<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials>' +
    `<AccessKeyId>ASIAE2E${n}</AccessKeyId><SecretAccessKey>secreto-${n}</SecretAccessKey>` +
    `<SessionToken>sesion-${n}</SessionToken><Expiration>${new Date(Date.now() + expiresInMs).toISOString()}</Expiration>` +
    '</Credentials><AssumedRoleUser><AssumedRoleId>AROAE2E:nexo-ws</AssumedRoleId>' +
    '<Arn>arn:aws:sts::123456789012:assumed-role/nexo-claude/nexo-ws</Arn></AssumedRoleUser></AssumeRoleResult>' +
    '<ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></AssumeRoleResponse>'
  );
}

const DENIED =
  '<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type>' +
  '<Code>AccessDenied</Code><Message>not authorized to perform sts:AssumeRole</Message></Error>' +
  '<RequestId>req-2</RequestId></ErrorResponse>';

function service(opts: { principalArn?: string | null; reply?: () => Response } = {}) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: String(init?.body ?? ''),
      headers: init?.headers as Record<string, string>,
    });
    return opts.reply ? opts.reply() : new Response(stsXml(3600_000, calls.length), { status: 200 });
  }) as typeof fetch;
  const values: Record<string, unknown> = {
    'jwt.secret': 'secreto-de-firma-de-pruebas-0123456789abcdef',
    'llm.aws.principalArn':
      opts.principalArn === undefined ? 'arn:aws:iam::999999999999:role/nexo-platform' : opts.principalArn,
    'llm.aws.stsEndpoint': 'https://sts.pruebas.example.com',
  };
  const svc = new AwsRoleService(
    { get: (k: string) => values[k] } as unknown as ConfigService,
    { safeFetch: () => fetchFn } as unknown as HttpClientService,
  );
  return { svc, calls };
}

describe('Rol de IAM + ExternalId (L3)', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    // Credenciales de la plataforma por la cadena estándar del SDK de AWS (aquí, variables de entorno ficticias).
    process.env.AWS_ACCESS_KEY_ID = 'AKIAPLATAFORMAE2E';
    process.env.AWS_SECRET_ACCESS_KEY = 'secreto-plataforma';
    delete process.env.AWS_PROFILE;
  });
  afterAll(() => {
    process.env = saved;
  });

  it('genera un ExternalId único por conexión con un comprobante ligado al workspace', () => {
    const { svc } = service();
    const a = svc.newExternalId('ws1');
    const b = svc.newExternalId('ws1');
    expect(a.externalId).toMatch(new RegExp(EXTERNAL_ID_PATTERN));
    expect(a.externalId).not.toBe(b.externalId);
    expect(svc.verifySetupToken(a.setupToken, 'ws1')).toBe(a.externalId);
    // Otro workspace no puede usar el ExternalId de un cliente (confused deputy) ni manipular el comprobante.
    expect(() => svc.verifySetupToken(a.setupToken, 'ws2')).toThrow(/ExternalId/);
    const [body, mac] = a.setupToken.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ws: 'ws1', xid: b.externalId, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString('base64url');
    expect(() => svc.verifySetupToken(`${forged}.${mac}`, 'ws1')).toThrow(/ExternalId/);
    expect(() => svc.verifySetupToken(`${body}.x${mac.slice(1)}`, 'ws1')).toThrow(/ExternalId/);
    expect(() => svc.verifySetupToken(undefined, 'ws1')).toThrow(/ExternalId/);
    // Un comprobante de otra instalación (otro secreto) no vale.
    const other = new AwsRoleService(
      { get: (k: string) => (k === 'jwt.secret' ? 'otro-secreto-0123456789abcdef0123456789' : null) } as never,
      { safeFetch: () => fetch } as never,
    );
    expect(() => other.verifySetupToken(a.setupToken, 'ws1')).toThrow(/ExternalId/);
  });

  it('plantillas: confianza solo para el principal de Nexo con sts:ExternalId; permisos mínimos por canal', () => {
    const { svc } = service();
    expect(svc.trustPolicy(ROLE.externalId)).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: 'arn:aws:iam::999999999999:role/nexo-platform' },
          Action: 'sts:AssumeRole',
          Condition: { StringEquals: { 'sts:ExternalId': ROLE.externalId } },
        },
      ],
    });
    expect(JSON.stringify(svc.permissionsPolicy('bedrock'))).toContain('bedrock-mantle:CreateInference');
    const aws = svc.permissionsPolicy('aws', { region: 'us-west-2', workspaceId: 'wrkspc_01Ab' });
    expect(aws.Statement[0]).toMatchObject({
      Resource: 'arn:aws:aws-external-anthropic:us-west-2:*:workspace/wrkspc_01Ab',
    });
    expect(svc.sessionName('cm1abc')).toBe('nexo-cm1abc');
  });

  it('sin LLM_AWS_PRINCIPAL_ARN el mecanismo no está disponible', async () => {
    const { svc } = service({ principalArn: null });
    expect(svc.unavailableReason()).toMatch(/LLM_AWS_PRINCIPAL_ARN/);
    await expect(svc.credentials(ROLE, 'nexo-ws')).rejects.toBeInstanceOf(KeylessAuthError);
  });

  it('asume el rol por safeFetch con el ExternalId y cachea las credenciales hasta su expiración', async () => {
    const { svc, calls } = service();
    const [c1, c2] = await Promise.all([svc.credentials(ROLE, 'nexo-ws'), svc.credentials(ROLE, 'nexo-ws')]);
    expect(c1).toEqual(c2);
    expect(c1).toMatchObject({ accessKeyId: 'ASIAE2E1', secretAccessKey: 'secreto-1', sessionToken: 'sesion-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sts.pruebas.example.com/');
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('Action')).toBe('AssumeRole');
    expect(params.get('RoleArn')).toBe(ROLE.roleArn);
    expect(params.get('ExternalId')).toBe(ROLE.externalId);
    expect(params.get('RoleSessionName')).toBe('nexo-ws');
    expect(params.get('DurationSeconds')).toBe('3600');
    // Firmado con SigV4 con las credenciales de la plataforma; sin cabecera host manual (la fija fetch).
    const auth = Object.entries(calls[0].headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAPLATAFORMAE2E\/\d{8}\/us-east-1\/sts\/aws4_request/);
    expect(Object.keys(calls[0].headers).map((k) => k.toLowerCase())).not.toContain('host');

    await svc.credentials(ROLE, 'nexo-ws');
    expect(calls).toHaveLength(1);
  });

  it('renueva 5 minutos antes de expirar', async () => {
    let n = 0;
    const { svc, calls } = service({ reply: () => new Response(stsXml(++n === 1 ? 60_000 : 3600_000, n)) });
    expect((await svc.credentials(ROLE, 'nexo-ws')).accessKeyId).toBe('ASIAE2E1');
    expect((await svc.credentials(ROLE, 'nexo-ws')).accessKeyId).toBe('ASIAE2E2');
    expect(calls).toHaveLength(2);
  });

  it('un AccessDenied de STS se explica sin el cuerpo de la respuesta', async () => {
    const { svc } = service({ reply: () => new Response(DENIED, { status: 403 }) });
    const err = (await svc.credentials(ROLE, 'nexo-ws').catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(KeylessAuthError);
    expect(err.message).toMatch(/política de confianza/);
    expect(err.message).not.toContain('not authorized');
  });
});

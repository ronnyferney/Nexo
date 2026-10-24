import { isPrivateAddress } from '../../../common/http/http-client.service';
import { buildOperationUrl, openApiToOperations, renderPath, RestAdapter } from './rest.adapter';
import { wsdlToOperations } from './soap.adapter';

describe('openApiToOperations', () => {
  it('convierte paths y parámetros en operaciones con plantillas', () => {
    const ops = openApiToOperations({
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            summary: 'Obtener usuario',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'expand', in: 'query', schema: { type: 'boolean' } },
            ],
          },
        },
        '/users': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } } },
      },
    });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      key: 'getUser',
      inputSchema: { required: ['id'] },
      definition: { method: 'GET', path: '/users/{{ input.id }}', query: { expand: '{{ input.expand }}' } },
    });
    expect(ops[1].key).toBe('post_users');
    expect(ops[1].definition).toMatchObject({ method: 'POST', body: '{{ input.body }}' });
  });
});

describe('wsdlToOperations', () => {
  it('extrae operaciones y soapAction del binding', () => {
    const wsdl = `<?xml version="1.0"?>
      <wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" targetNamespace="http://tempuri.org/">
        <wsdl:binding name="CalcSoap" type="tns:CalcSoap">
          <wsdl:operation name="Add"><soap:operation soapAction="http://tempuri.org/Add" /></wsdl:operation>
          <wsdl:operation name="Subtract"><soap:operation soapAction="http://tempuri.org/Subtract" /></wsdl:operation>
        </wsdl:binding>
      </wsdl:definitions>`;
    const ops = wsdlToOperations(wsdl);
    expect(ops.map((o) => o.key)).toEqual(['Add', 'Subtract']);
    expect(ops[0].definition).toMatchObject({ action: 'http://tempuri.org/Add' });
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.20.1.1', true],
    ['192.168.1.10', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['::1', true],
    ['::ffff:10.1.1.1', true],
    // A3: formas que antes se evaluaban como públicas
    ['::ffff:7f00:1', true],
    ['::ffff:a9fe:a9fe', true],
    ['64:ff9b::7f00:1', true],
    ['2002:7f00:1::', true],
    ['fec0::1', true],
    ['8.8.8.8', false],
    ['172.32.0.1', false],
  ])('%s -> %s', (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));
});

describe('RestAdapter successPath', () => {
  const run = async (body: unknown, successPath?: string) => {
    const http = { request: jest.fn().mockResolvedValue({ ok: true, status: 200, body, rawBody: '', durationMs: 1 }) };
    const auth = { resolve: jest.fn().mockResolvedValue({ headers: {}, query: {} }) };
    const adapter = new RestAdapter(http as never, auth as never);
    return adapter.invoke(
      {
        id: 'c',
        workspaceId: 'w',
        type: 'REST',
        config: { baseUrl: 'https://slack.com/api' },
        auth: { type: 'none' },
        secrets: {},
      },
      { key: 'post', definition: { method: 'POST', path: '/chat.postMessage', body: {}, successPath } },
      {},
    );
  };

  it('marca como fallida una respuesta HTTP 200 con ok: false (Slack)', async () => {
    expect((await run({ ok: false, error: 'channel_not_found' }, 'ok')).ok).toBe(false);
    expect((await run({ ok: true }, 'ok')).ok).toBe(true);
  });

  it('sin successPath conserva el comportamiento por estado HTTP', async () => {
    expect((await run({ ok: false })).ok).toBe(true);
  });
});

describe('RestAdapter: valores interpolados en la ruta (M4)', () => {
  const setup = (config: Record<string, unknown> = { baseUrl: 'https://api.example.com/v1' }) => {
    const urls: string[] = [];
    const http = {
      request: jest.fn((req: { url: string }) => {
        urls.push(req.url);
        return Promise.resolve({ ok: true, status: 200, body: {}, rawBody: '', durationMs: 1 });
      }),
    };
    const auth = { resolve: jest.fn().mockResolvedValue({ headers: {}, query: {} }) };
    const adapter = new RestAdapter(http as never, auth as never);
    const invoke = (definition: Record<string, unknown>, input: Record<string, unknown>) =>
      adapter.invoke(
        { id: 'c', workspaceId: 'w', type: 'REST', config, auth: { type: 'none' }, secrets: { TOKEN: 's3cr:eto' } },
        { key: 'op', definition: { method: 'GET', ...definition } },
        input,
      );
    const calledUrl = () => new URL(urls[0]);
    return { http, invoke, calledUrl };
  };

  it('codifica / ? # & de la entrada: no hay recorrido de ruta ni inyección de query', async () => {
    const { invoke, calledUrl } = setup();
    await invoke(
      { path: '/users/{{ input.id }}/notes', query: { q: '{{ input.q }}' } },
      {
        id: '../admin?role=owner#x',
        q: 'a&b=c',
      },
    );
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/users/..%2Fadmin%3Frole=owner%23x/notes');
    expect(url.search).toBe('?q=a%26b%3Dc');
    expect([...url.searchParams.keys()]).toEqual(['q']);
  });

  it.each(['..', '.'])('rechaza la entrada "%s" como segmento de ruta', async (id) => {
    const { http, invoke } = setup();
    await expect(invoke({ path: '/users/{{ input.id }}' }, { id })).rejects.toThrow(/segmentos "\." o "\.\."/);
    expect(http.request).not.toHaveBeenCalled();
  });

  it.each(['/users/%2e%2e/admin', '/users/%2E./admin', '/users/./x', '/a/../../admin'])(
    'rechaza el segmento de punto en la plantilla "%s"',
    async (path) => {
      const { http, invoke } = setup();
      await expect(invoke({ path }, {})).rejects.toThrow(/Ruta de operación inválida/);
      expect(http.request).not.toHaveBeenCalled();
    },
  );

  it('una entrada "%2e%2e" se codifica (%252e) y no se interpreta como ".."', async () => {
    const { invoke, calledUrl } = setup();
    await invoke({ path: '/users/{{ input.id }}/x' }, { id: '%2e%2e' });
    expect(calledUrl().pathname).toBe('/v1/users/%252e%252e/x');
  });

  it('una URL absoluta en la ruta no puede cambiar el host del conector', async () => {
    const { invoke, calledUrl } = setup();
    await expect(invoke({ path: 'https://evil.example/x' }, {})).rejects.toThrow(/debe ser api\.example\.com/);
    await expect(invoke({ path: '//evil.example/x' }, {})).rejects.toThrow(/Ruta de operación inválida/);
    await expect(invoke({ path: '/\\evil.example/x' }, {})).rejects.toThrow(/Ruta de operación inválida/);
    // Un valor de entrada nunca forma una URL absoluta: se codifica como segmento.
    await invoke({ path: '/{{ input.u }}' }, { u: 'https://evil.example/' });
    expect(calledUrl().host).toBe('api.example.com');
  });

  it('la entrada no puede cambiar el host aunque la baseUrl la interpole', async () => {
    const { http, invoke } = setup({ baseUrl: 'https://{{ input.tenant }}api.example.com/v1' });
    await expect(invoke({ path: '/x' }, { tenant: 'evil.example/?' })).rejects.toThrow(/Ruta de operación inválida/);
    expect(http.request).not.toHaveBeenCalled();
  });

  it('conserva ids con : @ = y la query literal de la plantilla', async () => {
    const { invoke, calledUrl } = setup();
    await invoke(
      { path: '/teams/{{ input.ch }}/m/{{ input.id }}?x={{ input.x }}' },
      {
        ch: '19:abc@thread.tacv2',
        id: 'AAMk_x-y=',
        x: 'a&b',
      },
    );
    const url = calledUrl();
    expect(url.pathname).toBe('/v1/teams/19:abc@thread.tacv2/m/AAMk_x-y=');
    expect(url.searchParams.get('x')).toBe('a&b');
  });

  it('una ruta absoluta al mismo host sigue permitida', () => {
    expect(buildOperationUrl('https://api.example.com/v1', 'https://api.example.com/v2/next').pathname).toBe(
      '/v2/next',
    );
  });

  it('renderPath codifica también secretos y objetos', () => {
    expect(renderPath('/bot{{ secrets.T }}/{{ input.o }}', { secrets: { T: 'a/b' }, input: { o: { k: 1 } } })).toBe(
      '/bota%2Fb/%7B%22k%22:1%7D',
    );
  });
});

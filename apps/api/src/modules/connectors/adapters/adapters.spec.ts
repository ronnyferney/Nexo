import { isPrivateAddress } from '../../../common/http/http-client.service';
import { openApiToOperations } from './rest.adapter';
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
    ['8.8.8.8', false],
    ['172.32.0.1', false],
  ])('%s -> %s', (ip, expected) => expect(isPrivateAddress(ip)).toBe(expected));
});

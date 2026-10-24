import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import { CATALOG } from '../catalog/catalog.index';
import { ConnectorsService } from '../connectors.service';
import {
  assertSafePattern,
  assertSafeSchemaPatterns,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_SUBJECT_LENGTH,
  safeRegExp,
  UnsafePatternError,
} from './safe-pattern';

describe('assertSafePattern (B6: ReDoS)', () => {
  it.each([
    '^(a+)+$',
    '^(a*)*$',
    '^(a|aa)+$',
    '^(a|a)*$',
    '^(.*a){20}$',
    '^(a?){25}a{25}$',
    '^(?:(?:x+)y)+$',
    '^(\\w+\\s?)+$',
    '^(a+b+c)+$', // delimitador c, pero dos cuantificadores entre delimitadores
    '^(x+\\.y*)+$', // `.` delimita, pero y* y x+ quedan en el mismo tramo al dar la vuelta
    '^([a-z.]+\\.)+$', // el delimitador lo consume el átomo cuantificado
    '(a)\\1',
    '(?<x>a)\\k<x>',
    'a'.repeat(MAX_PATTERN_LENGTH + 1),
  ])('rechaza %s', (pattern) => expect(() => assertSafePattern(pattern)).toThrow(UnsafePatternError));

  it.each([
    '^[A-Za-z0-9_.:-]{1,200}$',
    '^(?!\\.+$)(?!.*\\.\\.)[A-Za-z0-9_.:=@-]{1,512}$',
    '^(?:public_channel|im)(?:,(?:public_channel|im)){0,2}$',
    '^PT(?=\\d)([0-9]{1,2}H)?([0-9]{1,4}M)?$',
    '^[(+)*]+$', // cuantificadores dentro de una clase son literales
    '^\\(a+\\)+$', // paréntesis escapados no abren grupo
    '^(abc)+$', // grupo repetido sin cuantificador interno ni alternativas
    '^([a-z]+\\.)*[a-z]+$', // grupo delimitado por un literal que [a-z] no consume
    '^<[^<>\\s]{1,250}>([ \\t]+<[^<>\\s]{1,250}>){0,50}$',
    '^(?<anio>\\d{4})-(\\d{2})$',
  ])('acepta %s', (pattern) => expect(() => assertSafePattern(pattern)).not.toThrow());

  it('todos los patrones del catálogo pasan la política', () => {
    for (const entry of CATALOG) {
      for (const op of entry.operations) {
        expect(() => assertSafeSchemaPatterns(op.inputSchema)).not.toThrow();
      }
    }
  });

  it('recorre esquemas anidados y patternProperties', () => {
    expect(() =>
      assertSafeSchemaPatterns({ type: 'object', properties: { a: { items: { pattern: '^(a+)+$' } } } }),
    ).toThrow(UnsafePatternError);
    expect(() => assertSafeSchemaPatterns({ patternProperties: { '^(x|xx)*$': {} } })).toThrow(UnsafePatternError);
  });
});

describe('safeRegExp con Ajv', () => {
  const ajv = new Ajv({ strict: false, code: { regExp: safeRegExp } });

  it('valida como RegExp normal', () => {
    const validate = ajv.compile({ type: 'string', pattern: '^[a-z]{2,5}$' });
    expect(validate('hola')).toBe(true);
    expect(validate('HOLA')).toBe(false);
  });

  it('no compila un patrón peligroso', () => {
    expect(() => ajv.compile({ type: 'string', pattern: '^(a+)+$' })).toThrow(UnsafePatternError);
  });

  it('limita la longitud del texto evaluado', () => {
    const validate = ajv.compile({ type: 'string', pattern: '^[^\\r\\n]*$' });
    expect(validate('x'.repeat(MAX_PATTERN_SUBJECT_LENGTH))).toBe(true);
    expect(() => validate('x'.repeat(MAX_PATTERN_SUBJECT_LENGTH + 1))).toThrow(UnsafePatternError);
  });
});

describe('ConnectorsService: inputSchema con pattern peligroso', () => {
  const adapter = { type: 'REST', invoke: jest.fn().mockResolvedValue({ ok: true, data: {}, durationMs: 1 }) };
  const connector = {
    id: 'c1',
    workspaceId: 'w1',
    type: 'REST',
    config: {},
    auth: { type: 'none' },
    allowedSecrets: [],
  };
  const prisma = {
    connector: { findFirst: jest.fn().mockResolvedValue(connector) },
    connectorOperation: { create: jest.fn().mockResolvedValue({}) },
  };
  const secrets = { resolveMany: jest.fn().mockResolvedValue({}) };
  const service = new ConnectorsService(prisma as never, secrets as never, [adapter as never]);
  const op = (inputSchema: object) =>
    ({
      id: `op-${Math.random()}`,
      key: 'buscar',
      updatedAt: new Date(),
      definition: {},
      inputSchema,
      connector,
    }) as never;

  it('la invocación responde 400 en vez de bloquear el proceso con (a+)+$', async () => {
    const schema = { type: 'object', properties: { q: { type: 'string', pattern: '^(a+)+$' } } };
    const started = Date.now();
    await expect(service.invoke(op(schema), { q: `${'a'.repeat(40)}!` })).rejects.toBeInstanceOf(BadRequestException);
    expect(Date.now() - started).toBeLessThan(500);
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('un texto enorme contra un pattern responde 400', async () => {
    const schema = { type: 'object', properties: { q: { type: 'string', pattern: '^\\s*\\s*x$' } } };
    await expect(service.invoke(op(schema), { q: ' '.repeat(100_000) })).rejects.toThrow(/no puede superar/);
  });

  it('crear la operación con un pattern peligroso responde 400', async () => {
    await expect(
      service.createOperation({ workspaceId: 'w1', role: 'EDITOR', via: 'jwt' }, 'c1', {
        key: 'buscar',
        name: 'Buscar',
        definition: {},
        inputSchema: { type: 'object', properties: { q: { type: 'string', pattern: '^(a|aa)+$' } } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.connectorOperation.create).not.toHaveBeenCalled();
  });

  it('un pattern seguro valida normalmente', async () => {
    const schema = { type: 'object', properties: { q: { type: 'string', pattern: '^[a-z]+$' } } };
    await expect(service.invoke(op(schema), { q: 'abc' })).resolves.toMatchObject({ ok: true });
    await expect(service.invoke(op(schema), { q: 'ABC' })).rejects.toThrow(/must match pattern/);
  });
});

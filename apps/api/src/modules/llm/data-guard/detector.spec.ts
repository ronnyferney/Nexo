import { detect, type DataCategory } from './detector';
import { luhn, validCpf, validDniEs, validIban, validNie, validNit, validRut } from './validators';

/** Categorías y fragmentos detectados (solo para la prueba: el detector nunca devuelve valores). */
const found = (text: string, secrets?: string[]) =>
  detect(text, { secrets }).map((f) => ({ category: f.category, kind: f.kind, value: text.slice(f.start, f.end) }));
const categories = (text: string) => detect(text).map((f) => f.category);

describe('DataGuard · validadores', () => {
  it('Luhn, IBAN, DNI/NIE, NIT, CPF y RUT con sus dígitos de control', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(validIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
    expect(validIban('ES91 2100 0418 4502 0005 1333')).toBe(false);
    expect(validIban('DE89370400440532013000')).toBe(true);
    expect(validDniEs('12345678Z')).toBe(true);
    expect(validDniEs('12345678A')).toBe(false);
    expect(validNie('X1234567L')).toBe(true);
    expect(validNie('X1234567A')).toBe(false);
    expect(validNit('900.123.456-8')).toBe(true);
    expect(validNit('900.123.456-7')).toBe(false);
    expect(validNit('800.197.268-4')).toBe(true);
    expect(validCpf('529.982.247-25')).toBe(true);
    expect(validCpf('111.111.111-11')).toBe(false);
    expect(validRut('12.345.678-5')).toBe(true);
    expect(validRut('12.345.678-9')).toBe(false);
  });
});

describe('DataGuard · detector (positivos)', () => {
  const cases: [string, DataCategory, string, string][] = [
    ['Escríbame a ana.perez+ventas@empresa.com.co hoy', 'EMAIL', 'EMAIL', 'ana.perez+ventas@empresa.com.co'],
    ['Mi celular es 300 123 4567', 'PHONE', 'CO_MOBILE', '300 123 4567'],
    ['Llame al 3001234567.', 'PHONE', 'CO_MOBILE', '3001234567'],
    ['Fijo en Bogotá: 601 234 5678', 'PHONE', 'CO_LANDLINE', '601 234 5678'],
    ['WhatsApp +57 300 123 4567', 'PHONE', 'INTERNATIONAL', '+57 300 123 4567'],
    ['Oficina en Madrid +34 912 345 678', 'PHONE', 'INTERNATIONAL', '+34 912 345 678'],
    ['Móvil: 612 34 56 78', 'PHONE', 'PHONE_CONTEXT', '612 34 56 78'],
    ['Teléfono: (01) 4567890', 'PHONE', 'PHONE_CONTEXT', '(01) 4567890'],
    ['Pague con 4111 1111 1111 1111 vence 12/27', 'PAYMENT_CARD', 'CARD', '4111 1111 1111 1111'],
    ['Amex 3782-822463-10005', 'PAYMENT_CARD', 'CARD', '3782-822463-10005'],
    ['Transfiera a ES91 2100 0418 4502 0005 1332 hoy', 'BANK_ACCOUNT', 'IBAN', 'ES91 2100 0418 4502 0005 1332'],
    ['IBAN DE89370400440532013000.', 'BANK_ACCOUNT', 'IBAN', 'DE89370400440532013000'],
    ['Cuenta de ahorros No. 0123456789 de Bancolombia', 'BANK_ACCOUNT', 'ACCOUNT', '0123456789'],
    ['Mi cédula es 1.020.304.050', 'NATIONAL_ID', 'ID_CONTEXT', '1.020.304.050'],
    ['cédula de ciudadanía 79123456 expedida en Bogotá', 'NATIONAL_ID', 'ID_CONTEXT', '79123456'],
    ['C.C. 52.123.456', 'NATIONAL_ID', 'ID_CONTEXT', '52.123.456'],
    ['DNI 12345678 (Perú)', 'NATIONAL_ID', 'ID_CONTEXT', '12345678'],
    ['Pasaporte: AB1234567', 'NATIONAL_ID', 'ID_CONTEXT', 'AB1234567'],
    ['Factura a NIT 900.123.456-8', 'NATIONAL_ID', 'CO_NIT', '900.123.456-8'],
    ['DNI 12345678Z en Sevilla', 'NATIONAL_ID', 'ES_DNI', '12345678Z'],
    ['Su NIE es X1234567L', 'NATIONAL_ID', 'ES_NIE', 'X1234567L'],
    ['CPF 529.982.247-25', 'NATIONAL_ID', 'BR_CPF', '529.982.247-25'],
    ['RUT 12.345.678-5', 'NATIONAL_ID', 'CL_RUT', '12.345.678-5'],
    ['CURP GODE561231HDFRRN09', 'NATIONAL_ID', 'MX_CURP', 'GODE561231HDFRRN09'],
  ];

  it.each(cases)('%s → %s', (text, category, kind, value) => {
    expect(found(text)).toContainEqual({ category, kind, value });
  });

  it('credenciales: llaves de API, JWT, llaves privadas, cadenas de conexión y contraseñas en contexto', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFuYSJ9.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const text = [
      'clave sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      `token ${jwt}`,
      'AWS AKIAIOSFODNN7EXAMPLE',
      'postgres://admin:S3cr3t-pass@db.empresa.com:5432/app',
      'password: Hunter2!',
      'mi contraseña es Primavera2026',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const creds = found(text).filter((f) => f.category === 'CREDENTIAL');
    expect(creds.map((c) => c.kind)).toEqual([
      'API_KEY',
      'JWT',
      'API_KEY',
      'CONNECTION_STRING',
      'PASSWORD',
      'PASSWORD',
      'BEARER',
      'PRIVATE_KEY',
    ]);
    expect(creds.find((c) => c.kind === 'CONNECTION_STRING')?.value).toBe('S3cr3t-pass');
    expect(creds.find((c) => c.value === 'Primavera2026')).toBeDefined();
    // La contraseña de la cadena de conexión no se confunde con un correo.
    expect(found(text).some((f) => f.category === 'EMAIL')).toBe(false);
  });

  it('valores de la bóveda: el literal y su base64 son CREDENTIAL; los muy cortos se ignoran', () => {
    const secret = 'crm-token-7f3a9c';
    const text = `respuesta: ${secret} y ${Buffer.from(secret).toString('base64')} y 1234`;
    const creds = found(text, [secret, '1234']);
    expect(creds).toEqual([
      { category: 'CREDENTIAL', kind: 'VAULT', value: secret },
      { category: 'CREDENTIAL', kind: 'VAULT', value: Buffer.from(secret).toString('base64') },
    ]);
  });

  it('varias categorías en un mismo texto, en orden y sin solapamientos', () => {
    const text = 'Cliente Ana, cédula 1020304050, correo ana@x.co, cel 3105556677, tarjeta 5555555555554444.';
    expect(categories(text)).toEqual(['NATIONAL_ID', 'EMAIL', 'PHONE', 'PAYMENT_CARD']);
  });
});

describe('DataGuard · detector (falsos positivos)', () => {
  const negatives = [
    'Hola, ¿cuál es el estado del envío 123?',
    'El pedido 4111111111111112 no pasa Luhn',
    'Fecha 2026-10-24 a las 10:30, total $3.000.000 COP',
    'Pagamos 1.250.000 pesos en la factura FAC-2026-000123',
    'La guía 700000000 salió de Medellín',
    'Versión 3.2.1 del servicio, puerto 5432',
    'Tengo en cuenta 2 cosas: precio y plazo',
    'La palabra clave: logística',
    'El token es válido hasta mañana',
    'Use la clave: secreta para entrar',
    'ES91 2100 0418 4502 0005 1333 (IBAN con dígitos inválidos)',
    '12345678A con letra de control incorrecta',
    '900.123.456-7 con dígito de verificación incorrecto',
    'Una dirección IP 192.168.10.25 y un id 550e8400-e29b-41d4-a716-446655440000',
    'Coordenadas 4.7110, -74.0721',
    'Código postal 110111 y referencia 3001',
    'usuario@ sin dominio y @mención',
  ];

  it.each(negatives)('sin hallazgos: %s', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('con la palabra de contexto, un documento sin dígito de control válido sí se protege', () => {
    expect(categories('NIT 900.123.456-7')).toEqual(['NATIONAL_ID']);
  });

  it('textos grandes sin patrones se analizan en tiempo lineal (sin ReDoS)', () => {
    const big = `${'1-'.repeat(20_000)}${'a@'.repeat(10_000)}${'+1 '.repeat(10_000)}${'cuenta '.repeat(5_000)}`;
    const t0 = Date.now();
    detect(big);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

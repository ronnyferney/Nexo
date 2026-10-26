import { inspeccionarDeclarativo } from './crews.validator';

/**
 * Especificación del validador declarativo (ADR 0014 · D1, seguridad central). Acepta configuración declarativa de una
 * Cuadrilla y RECHAZA cada forma de código/hook/URL de arranque. Es el opuesto exacto de una plantilla con hooks de
 * terceros: una Cuadrilla nunca ejecuta nada al instanciarse.
 */
describe('inspeccionarDeclarativo (validador de Cuadrilla)', () => {
  describe('acepta configuración 100 % declarativa', () => {
    it('acepta un miembro con cargo, skills, conectores sugeridos, política y criterios', () => {
      const miembro = {
        rol: 'Analista de recaudo',
        cargoId: 'cargo-123',
        nivelEsperado: 'LIDER',
        skills: ['skill-a', 'skill-b'],
        conectoresSugeridos: [
          { connectorId: 'conn-1', operationId: 'op-listar', modo: 'USE' },
          { connectorId: 'conn-2', operationId: 'op-crear' },
        ],
        politicaSugerida: { politicaId: 'pol-9', limiteDiario: 100, requiereAprobacion: true },
        criteriosResultado: {
          reglaValidacion: {
            combinator: 'and',
            rules: [{ left: '{{ recaudo.confirmado }}', operator: 'eq', right: true }],
          },
          evidenciaExigida: ['confirmacion_tesoreria'],
        },
        delegaA: ['Auxiliar'],
      };
      expect(inspeccionarDeclarativo(miembro).ok).toBe(true);
    });

    it('acepta valores primitivos, listas vacías, null y plantillas de texto {{ var }}', () => {
      expect(inspeccionarDeclarativo({}).ok).toBe(true);
      expect(inspeccionarDeclarativo({ notas: 'Equipo de cobranza', activo: true, orden: 3, extra: null }).ok).toBe(
        true,
      );
      expect(inspeccionarDeclarativo({ saludo: 'Hola {{ cliente.nombre }}' }).ok).toBe(true);
      expect(inspeccionarDeclarativo({ skills: [], delegaA: [] }).ok).toBe(true);
    });

    it('acepta una URL de referencia legítima que NO es de arranque', () => {
      expect(inspeccionarDeclarativo({ documentacion: 'https://docs.interno/cobranza' }).ok).toBe(true);
    });
  });

  describe('rechaza claves ejecutables', () => {
    it.each([
      ['hooks', { hooks: { preInstall: 'rm -rf /' } }],
      ['hook', { hook: 'x' }],
      ['eval', { eval: '1+1' }],
      ['exec', { exec: 'ls' }],
      ['command', { command: 'curl evil' }],
      ['cmd', { cmd: 'sh' }],
      ['shell', { shell: '/bin/bash' }],
      ['script', { script: 'console.log(1)' }],
      ['code', { code: 'return 2' }],
      ['startupUrl', { startupUrl: 'https://evil/boot' }],
      ['bootstrap', { bootstrap: 'https://evil/init' }],
      ['onInstall', { onInstall: 'do()' }],
      ['on-install (separador)', { 'on-install': 'do()' }],
      ['onStart (hook de evento)', { onStart: 'x' }],
      ['anidada', { miembros: [{ rol: 'x', politicaSugerida: { hooks: [] } }] }],
    ])('rechaza la clave %s', (_nombre, valor) => {
      const r = inspeccionarDeclarativo(valor);
      expect(r.ok).toBe(false);
      expect(r.motivo).toBeDefined();
      expect(r.ruta).toBeDefined();
    });
  });

  describe('rechaza contenido ejecutable en valores de texto', () => {
    it.each([
      ['javascript:', { enlace: 'javascript:alert(1)' }],
      ['<script>', { texto: 'hola <script>alert(1)</script>' }],
      ['eval(', { nota: 'esto llama eval( x )' }],
      ['new Function(', { nota: 'const f = new Function("return 1")' }],
      ['require(', { nota: 'require("child_process")' }],
      ['child_process', { nota: 'usa child_process para correr' }],
      ['process.env', { nota: 'lee process.env.SECRET' }],
    ])('rechaza el contenido %s', (_nombre, valor) => {
      expect(inspeccionarDeclarativo(valor).ok).toBe(false);
    });
  });

  it('rechaza una función (defensa; no viaja en JSON pero se comprueba)', () => {
    expect(inspeccionarDeclarativo({ handlerFn: () => 1 }).ok).toBe(false);
    expect(inspeccionarDeclarativo({ raro: function run() {} }).ok).toBe(false);
  });

  it('informa la ruta del nodo rechazado para auditar', () => {
    const r = inspeccionarDeclarativo({ miembros: [{ politicaSugerida: { eval: 'x' } }] }, '$');
    expect(r.ok).toBe(false);
    expect(r.ruta).toContain('eval');
  });
});

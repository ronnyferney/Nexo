import {
  agruparPorEmpresa,
  esNombreSecretoValido,
  esProveedorSimulado,
  esSimulado,
  estadoCuentaMeta,
  estadoMensajeMeta,
  mensajeSecretRef,
  nuevaIdempotencyKey,
  pareceValorDeSecreto,
  tipoCanalMeta,
} from './canales.util';

describe('canales.util', () => {
  describe('tipoCanalMeta', () => {
    it('da etiqueta, color e ícono por tipo de canal', () => {
      expect(tipoCanalMeta('CORREO')).toEqual({ label: 'Correo', badge: 'info', icon: 'send' });
      expect(tipoCanalMeta('WHATSAPP').label).toBe('WhatsApp');
      expect(tipoCanalMeta('VOZ').icon).toBe('headset');
    });
  });

  describe('estadoCuentaMeta', () => {
    it('mapea estado de cuenta a color', () => {
      expect(estadoCuentaMeta('ACTIVA').badge).toBe('success');
      expect(estadoCuentaMeta('SUSPENDIDA').badge).toBe('warning');
      expect(estadoCuentaMeta('RETIRADA').badge).toBe('danger');
    });
  });

  describe('estadoMensajeMeta', () => {
    it('SIMULADO es informativo (sandbox)', () => {
      expect(estadoMensajeMeta('SIMULADO')).toEqual({ label: 'Simulado', badge: 'info' });
      expect(esSimulado('SIMULADO')).toBeTrue();
      expect(esSimulado('ENVIADO')).toBeFalse();
    });
    it('FALLIDO es rojo y PENDIENTE es de espera', () => {
      expect(estadoMensajeMeta('FALLIDO').badge).toBe('danger');
      expect(estadoMensajeMeta('PENDIENTE').badge).toBe('warning');
    });
    it('ENVIADO y ENTREGADO avanzan de color', () => {
      expect(estadoMensajeMeta('ENVIADO').badge).toBe('primary');
      expect(estadoMensajeMeta('ENTREGADO').badge).toBe('success');
    });
  });

  describe('esProveedorSimulado', () => {
    it('reconoce el proveedor de sandbox sin importar mayúsculas/espacios', () => {
      expect(esProveedorSimulado('simulado')).toBeTrue();
      expect(esProveedorSimulado('  SIMULADO ')).toBeTrue();
      expect(esProveedorSimulado('m365')).toBeFalse();
    });
  });

  describe('esNombreSecretoValido / mensajeSecretRef', () => {
    it('acepta nombres de clave de bóveda en MAYÚSCULAS', () => {
      expect(esNombreSecretoValido('M365_CLIENT_SECRET')).toBeTrue();
      expect(esNombreSecretoValido('TWILIO_TOKEN')).toBeTrue();
      expect(mensajeSecretRef('M365_CLIENT_SECRET')).toBeNull();
    });
    it('rechaza nombres mal formados', () => {
      expect(esNombreSecretoValido('x')).toBeFalse();
      expect(esNombreSecretoValido('123_KEY')).toBeFalse();
      expect(esNombreSecretoValido('')).toBeFalse();
    });
    it('no exige nada con el campo vacío', () => {
      expect(mensajeSecretRef('')).toBeNull();
      expect(mensajeSecretRef('   ')).toBeNull();
    });
    it('detecta cuando pegaron el VALOR del secreto en vez del nombre', () => {
      expect(pareceValorDeSecreto('sk-live-abc123def456')).toBeTrue();
      expect(pareceValorDeSecreto('mi contraseña')).toBeTrue();
      expect(pareceValorDeSecreto('M365_CLIENT_SECRET')).toBeFalse();
      expect(mensajeSecretRef('sk-live-abc123')).toContain('nunca el valor');
    });
  });

  describe('nuevaIdempotencyKey', () => {
    it('genera claves únicas con prefijo estable', () => {
      const a = nuevaIdempotencyKey();
      const b = nuevaIdempotencyKey();
      expect(a).toMatch(/^canal-/);
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(10);
    });
  });

  describe('agruparPorEmpresa', () => {
    it('agrupa cuentas por empresa conservando el orden', () => {
      const cuentas = [
        { empresaId: 'e1', id: 'a' },
        { empresaId: 'e2', id: 'b' },
        { empresaId: 'e1', id: 'c' },
      ];
      const grupos = agruparPorEmpresa(cuentas);
      expect(grupos.map((g) => g.empresaId)).toEqual(['e1', 'e2']);
      expect(grupos[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    });
    it('con lista vacía devuelve un arreglo vacío', () => {
      expect(agruparPorEmpresa([])).toEqual([]);
    });
  });
});

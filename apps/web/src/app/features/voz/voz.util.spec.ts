import {
  capaLabel,
  estadoActivacion,
  estadoLlamadaMeta,
  llamadaActiva,
  llamadaTerminada,
  proveedorInfo,
  validarRequisitosVoz,
  VOZ_CAPAS,
  VOZ_PROVEEDORES,
} from './voz.util';

describe('voz.util', () => {
  describe('estadoLlamadaMeta', () => {
    it('SIMULADA es informativa (sandbox) y FALLIDA es roja', () => {
      expect(estadoLlamadaMeta('SIMULADA')).toEqual({ label: 'Simulada', badge: 'info' });
      expect(estadoLlamadaMeta('FALLIDA').badge).toBe('danger');
    });
    it('FINALIZADA es verde y TRANSFERIDA de aviso', () => {
      expect(estadoLlamadaMeta('FINALIZADA').badge).toBe('success');
      expect(estadoLlamadaMeta('TRANSFERIDA').badge).toBe('warning');
    });
    it('cubre todos los estados del contrato', () => {
      const estados = ['INICIADA', 'EN_CURSO', 'TRANSFERIDA', 'FINALIZADA', 'FALLIDA', 'SIMULADA'] as const;
      for (const e of estados) expect(estadoLlamadaMeta(e).label.length).toBeGreaterThan(0);
    });
  });

  describe('llamadaTerminada / llamadaActiva', () => {
    it('FINALIZADA y FALLIDA están terminadas', () => {
      expect(llamadaTerminada('FINALIZADA')).toBeTrue();
      expect(llamadaTerminada('FALLIDA')).toBeTrue();
      expect(llamadaActiva('FINALIZADA')).toBeFalse();
    });
    it('INICIADA/EN_CURSO/SIMULADA/TRANSFERIDA siguen activas', () => {
      expect(llamadaActiva('INICIADA')).toBeTrue();
      expect(llamadaActiva('EN_CURSO')).toBeTrue();
      expect(llamadaActiva('SIMULADA')).toBeTrue();
      expect(llamadaActiva('TRANSFERIDA')).toBeTrue();
    });
  });

  describe('capaLabel / VOZ_CAPAS', () => {
    it('etiqueta las 4 capas', () => {
      expect(VOZ_CAPAS.length).toBe(4);
      expect(capaLabel('TELEFONIA')).toBe('Telefonía');
      expect(capaLabel('PROCESOS')).toContain('autorizaciones');
    });
  });

  describe('proveedorInfo', () => {
    it('resuelve por clave y por alias, ignorando mayúsculas/espacios', () => {
      expect(proveedorInfo('simulado')?.sandbox).toBeTrue();
      expect(proveedorInfo('  AMAZON_CONNECT ')?.proveedor).toBe('amazon_connect');
      expect(proveedorInfo('connect')?.proveedor).toBe('amazon_connect');
      expect(proveedorInfo('gcp')?.proveedor).toBe('google_cloud');
    });
    it('devuelve null para un proveedor desconocido', () => {
      expect(proveedorInfo('vonage')).toBeNull();
    });
    it('todos los proveedores declaran actionGateway en la capa de procesos', () => {
      for (const p of VOZ_PROVEEDORES) expect(p.capabilities.procesos).toContain('actionGateway');
    });
  });

  describe('estadoActivacion', () => {
    it('el simulado está siempre listo (sandbox, sin credenciales)', () => {
      const e = estadoActivacion('simulado', null);
      expect(e.activo).toBeTrue();
      expect(e.badge).toBe('info');
    });
    it('un stub sin secretRef está inactivo por falta de credenciales', () => {
      const e = estadoActivacion('amazon_connect', null);
      expect(e.activo).toBeFalse();
      expect(e.label).toContain('sin credenciales');
      expect(e.detalle).toContain('secretRef');
    });
    it('un stub con secretRef sigue inactivo por estar gated', () => {
      const e = estadoActivacion('google_cloud', 'GCP_CREDS');
      expect(e.activo).toBeFalse();
      expect(e.label).toContain('gated');
    });
    it('un proveedor desconocido no está soportado', () => {
      expect(estadoActivacion('vonage', 'X').badge).toBe('danger');
    });
    it('nunca filtra el valor del secreto, solo referencias', () => {
      const e = estadoActivacion('amazon_connect', 'CONNECT_CREDS');
      expect(e.detalle).not.toContain('CONNECT_CREDS');
    });
  });

  describe('validarRequisitosVoz', () => {
    it('acepta una saliente simple en el simulado', () => {
      expect(validarRequisitosVoz('simulado', { direccion: 'SALIENTE' })).toEqual([]);
    });
    it('acepta transferencia y barge-in en el simulado', () => {
      expect(validarRequisitosVoz('simulado', { direccion: 'SALIENTE', transferencia: true, bargeIn: true })).toEqual([]);
    });
    it('rechaza diálogo del proveedor en el simulado (solo externalDialog)', () => {
      const problemas = validarRequisitosVoz('simulado', { direccion: 'SALIENTE', dialogo: 'providerDialog' });
      expect(problemas.length).toBe(1);
      expect(problemas[0]).toContain('providerDialog');
    });
    it('Google Cloud declara diálogo del proveedor', () => {
      expect(validarRequisitosVoz('google_cloud', { direccion: 'SALIENTE', dialogo: 'providerDialog' })).toEqual([]);
    });
    it('reporta proveedor no soportado', () => {
      expect(validarRequisitosVoz('vonage', { direccion: 'SALIENTE' }).length).toBe(1);
    });
  });
});

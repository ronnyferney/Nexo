import type { VoiceCapabilities } from './domain/voice.types';
import { validarCapabilitiesVoz } from './voice-capabilities';

const COMPLETO: VoiceCapabilities = {
  telefonia: ['inbound', 'outbound', 'transfer', 'dtmf'],
  voz: ['streamingStt', 'tts', 'bargeIn'],
  dialogo: ['externalDialog', 'humanHandoff'],
  procesos: ['actionGateway'],
};

describe('validarCapabilitiesVoz', () => {
  it('acepta una combinación soportada (sin incompatibilidades)', () => {
    expect(validarCapabilitiesVoz(COMPLETO, { direccion: 'SALIENTE', transferencia: true, bargeIn: true })).toEqual([]);
  });

  it('bloquea saliente cuando la telefonía no soporta `outbound`', () => {
    const caps = { ...COMPLETO, telefonia: ['inbound'] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'SALIENTE' });
    expect(problemas.join(' ')).toContain('salientes');
  });

  it('bloquea entrante cuando la telefonía no soporta `inbound`', () => {
    const caps = { ...COMPLETO, telefonia: ['outbound'] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'ENTRANTE' });
    expect(problemas.join(' ')).toContain('entrantes');
  });

  it('bloquea transferencia cuando falta `transfer` en telefonía', () => {
    const caps = { ...COMPLETO, telefonia: ['inbound', 'outbound'] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'SALIENTE', transferencia: true });
    expect(problemas.join(' ')).toContain('transfer');
  });

  it('bloquea barge-in cuando el STT no lo soporta', () => {
    const caps = { ...COMPLETO, voz: ['streamingStt', 'tts'] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'SALIENTE', bargeIn: true });
    expect(problemas.join(' ')).toContain('barge-in');
  });

  it('bloquea diálogo externo (NEXO) cuando el proveedor solo ofrece diálogo propio', () => {
    const caps = { ...COMPLETO, dialogo: ['providerDialog'] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'SALIENTE', dialogo: 'externalDialog' });
    expect(problemas.join(' ')).toContain('externalDialog');
  });

  it('bloquea diálogo del proveedor cuando el adaptador no lo ofrece', () => {
    const problemas = validarCapabilitiesVoz(COMPLETO, { direccion: 'SALIENTE', dialogo: 'providerDialog' });
    expect(problemas.join(' ')).toContain('providerDialog');
  });

  it('exige la capa (d) por ActionGateway: un adaptador sin ella se bloquea', () => {
    const caps = { ...COMPLETO, procesos: [] as const };
    const problemas = validarCapabilitiesVoz(caps, { direccion: 'SALIENTE' });
    expect(problemas.join(' ')).toContain('actionGateway');
  });
});

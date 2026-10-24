import { isSecurityNotice, toolSlug } from './agent-chat.util';

describe('agent-chat.util', () => {
  describe('isSecurityNotice', () => {
    it('reconoce los avisos de protección de datos (DataGuard)', () => {
      expect(isSecurityNotice({ kind: 'notice', text: 'Protección de datos: se enmascararon 3 datos personales…' })).toBe(
        true,
      );
    });

    it('no marca como seguridad otros avisos ni otros tipos', () => {
      expect(isSecurityNotice({ kind: 'notice', text: 'El modelo cambió a uno de respaldo.' })).toBe(false);
      expect(isSecurityNotice({ kind: 'notice', text: 'Respuesta truncada por límite de tokens.' })).toBe(false);
      expect(isSecurityNotice({ kind: 'usage', text: 'Protección de datos…' })).toBe(false);
      expect(isSecurityNotice({ kind: 'notice' })).toBe(false);
    });
  });

  describe('toolSlug (debe coincidir con toolName del backend)', () => {
    it('conector + operación en minúsculas y saneados', () => {
      expect(toolSlug('HubSpot', 'search_contacts')).toBe('hubspot__search_contacts');
    });

    it('reemplaza espacios y símbolos por guion bajo y recorta extremos', () => {
      // El backend acota el conector a 24 caracteres antes del "__".
      expect(toolSlug('Microsoft 365 Correo (bandeja RG)', 'list_inbox')).toBe('microsoft_365_correo_ban__list_inbox');
    });

    it('acota el total a 64 caracteres', () => {
      expect(toolSlug('x'.repeat(40), 'y'.repeat(40)).length).toBe(64);
    });
  });
});

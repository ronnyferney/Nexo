import type { AgentVisibility } from '@prisma/client';
import { canEdit, canShare, decide, effectivePermission, type AccessFacts } from './agent-permissions';

type Role = AccessFacts['role'];
const facts = (over: Partial<AccessFacts> = {}): AccessFacts => ({
  isOwner: false,
  role: 'EDITOR',
  via: 'jwt',
  visibility: 'PRIVATE',
  share: null,
  ...over,
});

describe('Matriz de permisos de agentes (ADR 0007 D2)', () => {
  describe('permiso efectivo', () => {
    it('el dueño es OWNER en cualquier visibilidad', () => {
      for (const visibility of ['PRIVATE', 'TEAM', 'WORKSPACE'] as AgentVisibility[]) {
        expect(effectivePermission(facts({ isOwner: true, visibility }))).toBe('OWNER');
      }
    });

    it('PRIVATE ajeno es invisible para EDITOR y VIEWER aunque haya shares (quedan inactivos)', () => {
      for (const role of ['EDITOR', 'VIEWER'] as Role[]) {
        expect(effectivePermission(facts({ role }))).toBeNull();
        expect(effectivePermission(facts({ role, share: 'EDIT' }))).toBeNull();
      }
    });

    it('TEAM: solo con share (USE o EDIT); sin share no es visible', () => {
      expect(effectivePermission(facts({ visibility: 'TEAM' }))).toBeNull();
      expect(effectivePermission(facts({ visibility: 'TEAM', share: 'USE' }))).toBe('USE');
      expect(effectivePermission(facts({ visibility: 'TEAM', share: 'EDIT' }))).toBe('EDIT');
    });

    it('WORKSPACE: USE para cualquier miembro; EDIT con share EDIT', () => {
      expect(effectivePermission(facts({ visibility: 'WORKSPACE', role: 'VIEWER' }))).toBe('USE');
      expect(effectivePermission(facts({ visibility: 'WORKSPACE', share: 'EDIT' }))).toBe('EDIT');
    });

    it('ADMIN/OWNER del workspace ven todo como ADMIN_VIEW (salvo que sean dueños o tengan share EDIT)', () => {
      for (const role of ['ADMIN', 'OWNER'] as Role[]) {
        expect(effectivePermission(facts({ role }))).toBe('ADMIN_VIEW');
        expect(effectivePermission(facts({ role, visibility: 'WORKSPACE' }))).toBe('ADMIN_VIEW');
        expect(effectivePermission(facts({ role, visibility: 'TEAM', share: 'EDIT' }))).toBe('EDIT');
        expect(effectivePermission(facts({ role, isOwner: true }))).toBe('OWNER');
      }
    });

    it('una API key solo usa agentes WORKSPACE (sin identidad: ni dueña ni destinataria de shares)', () => {
      const key = { via: 'apiKey' as const, role: 'EDITOR' as const };
      expect(effectivePermission(facts({ ...key, visibility: 'WORKSPACE' }))).toBe('USE');
      expect(effectivePermission(facts({ ...key, visibility: 'TEAM', share: 'EDIT' }))).toBeNull();
      expect(effectivePermission(facts({ ...key, isOwner: true }))).toBeNull();
    });
  });

  describe('decisión USE/EDIT (404 / 403)', () => {
    it('no visible → NOT_FOUND para USE y para EDIT', () => {
      expect(decide(facts(), 'USE').outcome).toBe('NOT_FOUND');
      expect(decide(facts(), 'EDIT').outcome).toBe('NOT_FOUND');
    });

    it('USE no basta para editar → FORBIDDEN', () => {
      const f = facts({ visibility: 'WORKSPACE' });
      expect(decide(f, 'USE')).toEqual({ outcome: 'OK', permission: 'USE' });
      expect(decide(f, 'EDIT')).toEqual({ outcome: 'FORBIDDEN', permission: 'USE' });
    });

    it('share EDIT, dueño y gobierno de ADMIN pueden editar', () => {
      expect(decide(facts({ visibility: 'TEAM', share: 'EDIT' }), 'EDIT').outcome).toBe('OK');
      expect(decide(facts({ isOwner: true, visibility: 'TEAM' }), 'EDIT').outcome).toBe('OK');
      expect(decide(facts({ role: 'ADMIN' }), 'EDIT').outcome).toBe('OK');
    });

    it('el rol es un tope: un VIEWER solo edita sus agentes PRIVATE', () => {
      expect(decide(facts({ role: 'VIEWER', isOwner: true }), 'EDIT').outcome).toBe('OK');
      expect(decide(facts({ role: 'VIEWER', isOwner: true, visibility: 'TEAM' }), 'EDIT').outcome).toBe('FORBIDDEN');
      expect(decide(facts({ role: 'VIEWER', visibility: 'TEAM', share: 'EDIT' }), 'EDIT').outcome).toBe('FORBIDDEN');
      expect(decide(facts({ role: 'VIEWER', visibility: 'TEAM', share: 'EDIT' }), 'USE').outcome).toBe('OK');
    });

    it('canEdit nunca concede con USE o sin permiso', () => {
      expect(canEdit(facts({ role: 'OWNER' }), 'USE')).toBe(false);
      expect(canEdit(facts({ role: 'OWNER' }), null)).toBe(false);
    });
  });

  it('compartir (TEAM/WORKSPACE) exige EDITOR+ con usuario', () => {
    expect(canShare({ role: 'VIEWER', via: 'jwt' })).toBe(false);
    expect(canShare({ role: 'EDITOR', via: 'jwt' })).toBe(true);
    expect(canShare({ role: 'ADMIN', via: 'jwt' })).toBe(true);
    expect(canShare({ role: 'EDITOR', via: 'apiKey' })).toBe(false);
  });
});

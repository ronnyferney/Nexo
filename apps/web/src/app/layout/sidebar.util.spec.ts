import {
  activeGroupId,
  activeItemPath,
  canSee,
  cleanPath,
  filterGroups,
  isItemActive,
  NAV_GROUPS,
  type NavGroup,
  normalize,
  visibleGroups,
} from './sidebar.util';

describe('sidebar.util', () => {
  describe('NAV_GROUPS', () => {
    it('no tiene rutas duplicadas y cubre todos los enlaces (portal + admin + plataforma)', () => {
      const paths = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.path));
      expect(new Set(paths).size).toBe(paths.length);
      // 24 portal + 17 admin + 3 plataforma = 44 enlaces.
      expect(paths.length).toBe(44);
      expect(paths).toContain('/');
      expect(paths).toContain('/admin');
      expect(paths).toContain('/platform');
    });

    it('cada grupo tiene id único y al menos un ítem', () => {
      const ids = NAV_GROUPS.map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const g of NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
    });

    it('marca «Inicio» como grupo fijado', () => {
      expect(NAV_GROUPS.find((g) => g.id === 'home')?.pinned).toBeTrue();
    });
  });

  describe('canSee', () => {
    const all = { path: '/x', label: 'X', icon: 'x', exact: false, scope: 'all' as const };
    const admin = { ...all, scope: 'admin' as const };
    const platform = { ...all, scope: 'platform' as const };

    it('los ítems «all» se ven siempre', () => {
      expect(canSee(all, { isAdmin: false, isPlatformAdmin: false })).toBeTrue();
    });
    it('los ítems «admin» solo con rol de administración', () => {
      expect(canSee(admin, { isAdmin: false, isPlatformAdmin: false })).toBeFalse();
      expect(canSee(admin, { isAdmin: true, isPlatformAdmin: false })).toBeTrue();
    });
    it('los ítems «platform» solo con rol de plataforma', () => {
      expect(canSee(platform, { isAdmin: true, isPlatformAdmin: false })).toBeFalse();
      expect(canSee(platform, { isAdmin: false, isPlatformAdmin: true })).toBeTrue();
    });
  });

  describe('visibleGroups', () => {
    it('un VIEWER solo ve ítems «all» y ningún grupo exclusivo de admin/plataforma', () => {
      const groups = visibleGroups(NAV_GROUPS, { isAdmin: false, isPlatformAdmin: false });
      const paths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(paths.every((p) => !p.startsWith('/admin') && !p.startsWith('/platform'))).toBeTrue();
      expect(groups.find((g) => g.id === 'platform')).toBeUndefined();
      // El grupo «Administración» es íntegramente admin: desaparece para un VIEWER.
      expect(groups.find((g) => g.id === 'admin')).toBeUndefined();
      // «Organización» tiene ítems «all» (integraciones/conectores): sigue visible, recortado.
      expect(groups.find((g) => g.id === 'org')?.items.map((i) => i.path)).toEqual(['/integrations', '/connectors']);
    });

    it('un admin ve los grupos y enlaces de administración', () => {
      const groups = visibleGroups(NAV_GROUPS, { isAdmin: true, isPlatformAdmin: false });
      expect(groups.find((g) => g.id === 'admin')).toBeDefined();
      expect(groups.flatMap((g) => g.items.map((i) => i.path))).toContain('/admin/politicas');
      expect(groups.find((g) => g.id === 'platform')).toBeUndefined();
    });

    it('un admin de plataforma ve el grupo de plataforma', () => {
      const groups = visibleGroups(NAV_GROUPS, { isAdmin: true, isPlatformAdmin: true });
      expect(groups.find((g) => g.id === 'platform')?.items.length).toBe(3);
    });

    it('no muta la estructura original', () => {
      const before = NAV_GROUPS.flatMap((g) => g.items).length;
      visibleGroups(NAV_GROUPS, { isAdmin: false, isPlatformAdmin: false });
      expect(NAV_GROUPS.flatMap((g) => g.items).length).toBe(before);
    });
  });

  describe('normalize', () => {
    it('quita acentos y pasa a minúsculas', () => {
      expect(normalize('  Políticas ')).toBe('politicas');
      expect(normalize('Ejecución')).toBe('ejecucion');
    });
  });

  describe('filterGroups', () => {
    const groups: NavGroup[] = [
      { id: 'a', label: 'A', icon: 'x', items: [{ path: '/politicas', label: 'Políticas', icon: 'x', exact: false, scope: 'all' }] },
      {
        id: 'b',
        label: 'B',
        icon: 'x',
        items: [
          { path: '/agents', label: 'Agentes', icon: 'x', exact: false, scope: 'all' },
          { path: '/skills', label: 'Skills', icon: 'x', exact: false, scope: 'all' },
        ],
      },
    ];

    it('con consulta vacía devuelve todos los grupos', () => {
      expect(filterGroups(groups, '')).toEqual(groups);
      expect(filterGroups(groups, '   ')).toEqual(groups);
    });

    it('filtra sin acentos ni mayúsculas y descarta grupos sin coincidencias', () => {
      const res = filterGroups(groups, 'politic');
      expect(res.length).toBe(1);
      expect(res[0].id).toBe('a');
    });

    it('recorta los ítems del grupo a los que coinciden', () => {
      const res = filterGroups(groups, 'skills');
      expect(res.length).toBe(1);
      expect(res[0].items.map((i) => i.path)).toEqual(['/skills']);
    });
  });

  describe('isItemActive / cleanPath', () => {
    const agents = { path: '/agents', label: 'Agentes', icon: 'x', exact: true, scope: 'all' as const };
    const skills = { path: '/skills', label: 'Skills', icon: 'x', exact: false, scope: 'all' as const };

    it('respeta la coincidencia exacta', () => {
      expect(isItemActive(agents, '/agents')).toBeTrue();
      expect(isItemActive(agents, '/agents/explore')).toBeFalse();
    });
    it('coincide por prefijo cuando no es exacto', () => {
      expect(isItemActive(skills, '/skills')).toBeTrue();
      expect(isItemActive(skills, '/skills/42')).toBeTrue();
      expect(isItemActive(skills, '/skillset')).toBeFalse();
    });
    it('cleanPath elimina query y fragmento', () => {
      expect(cleanPath('/skills?tab=1#top')).toBe('/skills');
    });
  });

  describe('activeItemPath / activeGroupId', () => {
    it('elige la coincidencia más específica', () => {
      expect(activeItemPath(NAV_GROUPS, '/agents/explore')).toBe('/agents/explore');
      expect(activeItemPath(NAV_GROUPS, '/agents')).toBe('/agents');
      expect(activeItemPath(NAV_GROUPS, '/trabajo/objetivos')).toBe('/trabajo/objetivos');
    });

    it('ignora query y fragmento', () => {
      expect(activeItemPath(NAV_GROUPS, '/connectors/5?x=1')).toBe('/connectors');
    });

    it('devuelve null si ninguna ruta coincide', () => {
      expect(activeItemPath(NAV_GROUPS, '/ruta-inexistente')).toBeNull();
      expect(activeGroupId(NAV_GROUPS, '/ruta-inexistente')).toBeNull();
    });

    it('resuelve el grupo que contiene al ítem activo', () => {
      expect(activeGroupId(NAV_GROUPS, '/agents/explore')).toBe('agents');
      expect(activeGroupId(NAV_GROUPS, '/admin/politicas')).toBe('governance');
      expect(activeGroupId(NAV_GROUPS, '/')).toBe('home');
    });
  });
});

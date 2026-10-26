/**
 * Lógica pura de la barra lateral (sin Angular): arquitectura de información (grupos e ítems),
 * filtrado por texto, cálculo del ítem/grupo activo según la ruta y visibilidad por rol.
 *
 * Se mantiene aquí, con pruebas unitarias propias (`sidebar.util.spec.ts`), para que el componente
 * sea solo presentación y estado reactivo.
 */

/** Ámbito de visibilidad de un ítem: todos los miembros, solo administración o solo plataforma. */
export type NavScope = 'all' | 'admin' | 'platform';

/** Un enlace de navegación de la barra lateral. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** Si es `true`, el ítem solo se marca activo con coincidencia exacta de ruta. */
  exact: boolean;
  /** Quién puede ver el ítem. */
  scope: NavScope;
}

/** Una sección agrupada de la barra lateral, con encabezado colapsable (salvo las fijadas). */
export interface NavGroup {
  /** Identificador estable (se usa para persistir el pliegue y para `aria`). */
  id: string;
  label: string;
  icon: string;
  /** Si es `true`, la sección se muestra siempre desplegada y sin encabezado colapsable (p. ej. «Inicio»). */
  pinned?: boolean;
  items: NavItem[];
}

/** Flags de visibilidad derivados de la sesión. */
export interface NavVisibility {
  isAdmin: boolean;
  isPlatformAdmin: boolean;
}

/**
 * Arquitectura de información del menú lateral. Reorganiza en secciones lógicas todos los enlaces
 * existentes (portal + administración + plataforma); ningún enlace se elimina. La visibilidad real
 * la decide `scope` + `visibleGroups`.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'home',
    label: 'Inicio',
    icon: 'dashboard',
    pinned: true,
    items: [{ path: '/', label: 'Inicio', icon: 'dashboard', exact: true, scope: 'all' }],
  },
  {
    id: 'work',
    label: 'Mi trabajo',
    icon: 'checkCircle',
    items: [
      { path: '/trabajo', label: 'Mi trabajo', icon: 'checkCircle', exact: false, scope: 'all' },
      { path: '/trabajo/objetivos', label: 'Objetivos', icon: 'target', exact: false, scope: 'all' },
      { path: '/aprobaciones', label: 'Aprobaciones', icon: 'thumbsUp', exact: false, scope: 'all' },
      { path: '/agent-runs', label: 'Historial de tareas', icon: 'list', exact: false, scope: 'all' },
    ],
  },
  {
    id: 'agents',
    label: 'Agentes',
    icon: 'bot',
    items: [
      { path: '/agents', label: 'Agentes', icon: 'bot', exact: true, scope: 'all' },
      { path: '/agents/explore', label: 'Explorar agentes', icon: 'search', exact: false, scope: 'all' },
      { path: '/cargos', label: 'Cargos', icon: 'layers', exact: false, scope: 'all' },
      { path: '/cuadrillas', label: 'Cuadrillas', icon: 'users', exact: false, scope: 'all' },
      { path: '/skills', label: 'Skills', icon: 'sparkles', exact: false, scope: 'all' },
      { path: '/knowledge', label: 'Conocimiento', icon: 'book', exact: false, scope: 'all' },
      { path: '/routines', label: 'Rutinas', icon: 'calendar', exact: false, scope: 'all' },
    ],
  },
  {
    id: 'comms',
    label: 'Trabajo y comunicación',
    icon: 'send',
    items: [
      { path: '/mensajes', label: 'Mensajes', icon: 'send', exact: false, scope: 'all' },
      { path: '/canales', label: 'Canales', icon: 'branch', exact: false, scope: 'all' },
      { path: '/workflows', label: 'Flujos', icon: 'flow', exact: false, scope: 'all' },
      { path: '/executions', label: 'Ejecuciones', icon: 'history', exact: false, scope: 'all' },
    ],
  },
  {
    id: 'org',
    label: 'Organización',
    icon: 'building',
    items: [
      { path: '/admin/organization', label: 'Organización', icon: 'building', exact: false, scope: 'admin' },
      { path: '/admin/estructura', label: 'Estructura', icon: 'subunit', exact: false, scope: 'admin' },
      { path: '/admin/dimensiones', label: 'Dimensiones', icon: 'hash', exact: false, scope: 'admin' },
      { path: '/admin/groups', label: 'Grupos', icon: 'users', exact: false, scope: 'admin' },
      { path: '/integrations', label: 'Apps conectadas', icon: 'puzzle', exact: false, scope: 'all' },
      { path: '/connectors', label: 'Conectores', icon: 'plug', exact: false, scope: 'all' },
    ],
  },
  {
    id: 'direction',
    label: 'Dirección',
    icon: 'trophy',
    items: [{ path: '/consola-gerencial', label: 'Consola gerencial', icon: 'chart', exact: false, scope: 'admin' }],
  },
  {
    id: 'governance',
    label: 'Gobierno',
    icon: 'shield',
    items: [
      { path: '/supervision', label: 'Supervisión', icon: 'inbox', exact: false, scope: 'all' },
      { path: '/resultados', label: 'Indicadores de resultado', icon: 'chart', exact: false, scope: 'all' },
      { path: '/excepciones', label: 'Excepciones', icon: 'alert', exact: false, scope: 'all' },
      { path: '/admin/politicas', label: 'Políticas', icon: 'scale', exact: false, scope: 'admin' },
      { path: '/admin/suspension', label: 'Suspensión', icon: 'stop', exact: false, scope: 'admin' },
      { path: '/admin/alerts', label: 'Alertas', icon: 'bell', exact: false, scope: 'admin' },
      { path: '/admin/security', label: 'Seguridad', icon: 'shield', exact: false, scope: 'admin' },
    ],
  },
  {
    id: 'finance',
    label: 'Finanzas',
    icon: 'wallet',
    items: [
      { path: '/admin', label: 'Costos', icon: 'chart', exact: true, scope: 'admin' },
      { path: '/admin/budgets', label: 'Presupuestos', icon: 'wallet', exact: false, scope: 'admin' },
      { path: '/admin/imputacion', label: 'Imputación de costos', icon: 'scale', exact: false, scope: 'admin' },
      { path: '/my-usage', label: 'Mi consumo', icon: 'wallet', exact: false, scope: 'all' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    icon: 'settings',
    items: [
      { path: '/admin/providers', label: 'IA conectada', icon: 'cpu', exact: false, scope: 'admin' },
      { path: '/admin/edges', label: 'Nexo Edge', icon: 'server', exact: false, scope: 'admin' },
      { path: '/admin/settings', label: 'Ajustes', icon: 'settings', exact: false, scope: 'admin' },
    ],
  },
  {
    id: 'platform',
    label: 'Plataforma Nexo',
    icon: 'trophy',
    items: [
      { path: '/platform', label: 'Éxito de clientes', icon: 'trophy', exact: true, scope: 'platform' },
      { path: '/platform/copilot-quality', label: 'Calidad del Copilot', icon: 'sparkles', exact: false, scope: 'platform' },
      { path: '/platform/oauth-apps', label: 'Apps de inicio de sesión', icon: 'plug', exact: false, scope: 'platform' },
    ],
  },
];

/** `true` si el ítem debe verse con los flags de sesión dados. */
export function canSee(item: NavItem, vis: NavVisibility): boolean {
  if (item.scope === 'admin') return vis.isAdmin;
  if (item.scope === 'platform') return vis.isPlatformAdmin;
  return true;
}

/**
 * Filtra cada grupo dejando solo los ítems visibles según el rol y descarta los grupos que quedan vacíos.
 * No muta la estructura original.
 */
export function visibleGroups(groups: readonly NavGroup[], vis: NavVisibility): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, vis)) }))
    .filter((g) => g.items.length > 0);
}

/** Normaliza para búsquedas: minúsculas y sin acentos. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Filtra los grupos por texto (sobre la etiqueta del ítem, sin acentos ni mayúsculas). Con consulta
 * vacía devuelve los grupos tal cual. Descarta los grupos sin coincidencias.
 */
export function filterGroups(groups: readonly NavGroup[], query: string): NavGroup[] {
  const q = normalize(query);
  if (!q) return groups.map((g) => ({ ...g }));
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => normalize(i.label).includes(q)) }))
    .filter((g) => g.items.length > 0);
}

/** `true` si la ruta activa corresponde al ítem. */
export function isItemActive(item: NavItem, path: string): boolean {
  return item.exact ? path === item.path : path === item.path || path.startsWith(`${item.path}/`);
}

/** Quita la query/fragmento de una URL para comparar solo el path. */
export function cleanPath(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Ruta del ítem activo: la coincidencia más específica (así `/agents/explore` no activa también `/agents`).
 * Devuelve `null` si ninguna ruta coincide.
 */
export function activeItemPath(groups: readonly NavGroup[], url: string): string | null {
  const path = cleanPath(url);
  const matches = groups.flatMap((g) => g.items).filter((i) => isItemActive(i, path));
  return matches.sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null;
}

/** Id del grupo que contiene al ítem activo, o `null`. */
export function activeGroupId(groups: readonly NavGroup[], url: string): string | null {
  const active = activeItemPath(groups, url);
  if (!active) return null;
  return groups.find((g) => g.items.some((i) => i.path === active))?.id ?? null;
}

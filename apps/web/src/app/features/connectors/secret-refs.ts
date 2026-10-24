/**
 * Referencias `{{ secrets.NOMBRE }}` de una configuración (réplica de
 * `apps/api/src/modules/connectors/domain/secret-refs.ts`). Solo sirve para avisar en el editor: la API es la que
 * decide qué secretos puede resolver un conector (auditoría A4).
 */
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Nombres referenciados; `secrets` representa el uso de la bóveda completa (`{{ secrets | json }}`). */
export function secretRefs(...values: unknown[]): string[] {
  const names = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64) return;
    if (typeof value === 'string') {
      for (const m of value.matchAll(EXPR)) {
        const path = m[1].split('|')[0].trim();
        if (/^'.*'$|^".*"$/.test(path)) continue;
        const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
        if (parts[0] === 'secrets') names.add(parts[1] ?? 'secrets');
      }
    } else if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v, depth + 1);
    }
  };
  for (const v of values) visit(v, 0);
  return [...names].sort();
}

/** Referencias que la lista de permitidos no cubre (la bóveda completa nunca se permite). */
export function blockedRefs(refs: readonly string[], allowed: readonly string[] | undefined): string[] {
  const ok = new Set(allowed ?? []);
  return refs.filter((r) => r === 'secrets' || !ok.has(r));
}

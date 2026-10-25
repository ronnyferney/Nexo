/**
 * Filtra una lista de nombres de íconos por el texto de búsqueda. La comparación no distingue mayúsculas, ignora
 * espacios al borde y separa el `camelCase` para que «flecha» o «arrow left» encuentren `arrowLeft`.
 */
export function filterIconNames(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...names];
  return names.filter((name) => {
    const haystack = `${name} ${name.replace(/([a-z])([A-Z])/g, '$1 $2')}`.toLowerCase();
    return haystack.includes(q);
  });
}

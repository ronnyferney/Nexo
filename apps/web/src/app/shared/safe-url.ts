/** Solo URLs absolutas http(s): evita redirecciones a `javascript:` u otros esquemas devueltos por la API. */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

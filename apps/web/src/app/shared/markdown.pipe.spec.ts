import { MarkdownPipe } from './markdown.pipe';

describe('MarkdownPipe', () => {
  const pipe = new MarkdownPipe();

  it('vacío o nulo devuelve cadena vacía', () => {
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('escapa el HTML del contenido (correo no confiable): nunca emite etiquetas del texto', () => {
    const out = pipe.transform('Hola <img src=x onerror=alert(1)> y <script>robar()</script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('negrita, cursiva y código en línea', () => {
    expect(pipe.transform('**fuerte** y *suave* con `cod`')).toContain('<strong>fuerte</strong>');
    expect(pipe.transform('**fuerte** y *suave* con `cod`')).toContain('<em>suave</em>');
    expect(pipe.transform('**fuerte** y *suave* con `cod`')).toContain('<code>cod</code>');
  });

  it('encabezados por nivel', () => {
    expect(pipe.transform('# Uno')).toBe('<h1>Uno</h1>');
    expect(pipe.transform('### Tres')).toBe('<h3>Tres</h3>');
  });

  it('listas con viñetas y numeradas', () => {
    expect(pipe.transform('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(pipe.transform('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('tablas con encabezado y filas', () => {
    const out = pipe.transform('| Dato | Valor |\n|---|---|\n| Cuenta | admin@x.com |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>Dato</th>');
    expect(out).toContain('<td>admin@x.com</td>');
  });

  it('enlaces solo con esquema seguro; javascript: queda como texto', () => {
    expect(pipe.transform('[ok](https://nexo.test)')).toContain('<a href="https://nexo.test"');
    const danger = pipe.transform('[x](javascript:alert(1))');
    expect(danger).not.toContain('<a ');
    expect(danger).toContain('[x]');
  });

  it('bloque de código preserva el texto escapado sin formatearlo', () => {
    const out = pipe.transform('```\n<b>no</b> **tampoco**\n```');
    expect(out).toContain('<pre><code>&lt;b&gt;no&lt;/b&gt; **tampoco**</code></pre>');
    expect(out).not.toContain('<strong>');
  });
});

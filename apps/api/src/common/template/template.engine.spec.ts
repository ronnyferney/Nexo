import { escapeXml, getPath, render, renderXml } from './template.engine';

describe('template engine', () => {
  const ctx = { input: { name: 'Ana', tags: ['a', 'b'], n: 3 }, nodes: { x: { output: { ok: true } } } };

  it('resuelve rutas anidadas e índices', () => {
    expect(getPath(ctx, 'input.tags[1]')).toBe('b');
    expect(getPath(ctx, 'input.missing.deep')).toBeUndefined();
  });

  it('conserva el tipo cuando la cadena es una sola expresión', () => {
    expect(render('{{ input.n }}', ctx)).toBe(3);
    expect(render('{{ nodes.x.output }}', ctx)).toEqual({ ok: true });
  });

  it('interpola texto y aplica filtros', () => {
    expect(render('Hola {{ input.name | upper }}', ctx)).toBe('Hola ANA');
    expect(render("{{ input.city | default:'Bogotá' }}", ctx)).toBe('Bogotá');
    expect(render('{{ input.tags | length }}', ctx)).toBe(2);
  });

  it('omit vacía el valor solo si coincide exactamente con el argumento', () => {
    const tpl = "{{ input.f | default:'isRead eq false' | omit:'todos' }}";
    expect(render(tpl, { input: {} })).toBe('isRead eq false');
    expect(render(tpl, { input: { f: 'todos' } })).toBeUndefined();
    expect(render(tpl, { input: { f: 'todos ' } })).toBe('todos ');
    expect(render('x={{ input.f | omit:"a" }}', { input: { f: 'a' } })).toBe('x=');
  });

  it('renderiza objetos recursivamente', () => {
    expect(render({ a: ['{{ input.name }}'], b: { c: '{{ input.n }}' } }, ctx)).toEqual({ a: ['Ana'], b: { c: 3 } });
  });

  it('bloquea acceso a prototipos', () => {
    expect(getPath(ctx, 'input.__proto__')).toBeUndefined();
    expect(getPath(ctx, 'constructor')).toBeUndefined();
  });

  it('escapa valores en XML', () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(renderXml('<n>{{ input.name }}</n>', { input: { name: '<x>' } })).toBe('<n>&lt;x&gt;</n>');
  });
});

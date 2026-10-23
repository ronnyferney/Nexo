import { chunkText, normalizeText } from './chunker';
import { decodeEntities, fileToText, htmlTitle, htmlToText } from './text-extract';

const sentence = (i: number) => `Esta es la frase número ${i} del documento de prueba con algo de contenido.`;

describe('chunkText', () => {
  it('devuelve [] para texto vacío y un único fragmento para texto corto', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
    expect(chunkText('  Hola mundo.  ')).toEqual(['Hola mundo.']);
  });

  it('respeta el tamaño máximo y cubre todo el texto con solapamiento', () => {
    const text = Array.from({ length: 120 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
    // Cada fragmento (salvo el primero) comparte texto con el final del anterior.
    for (let i = 1; i < chunks.length; i++) {
      const head = chunks[i].slice(0, 40);
      expect(chunks[i - 1]).toContain(head);
    }
    // Nada se pierde: la primera y la última frase están presentes.
    expect(chunks[0]).toContain(sentence(0));
    expect(chunks[chunks.length - 1]).toContain(sentence(119));
    // Los cortes caen en fin de frase.
    for (const c of chunks.slice(0, -1)) expect(c.endsWith('.')).toBe(true);
  });

  it('prefiere cortar en límites de párrafo', () => {
    const para = (i: number) => `Párrafo ${i}. ${'palabra '.repeat(80).trim()}.`;
    const text = [para(1), para(2), para(3), para(4)].join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith('Párrafo 1.')).toBe(true);
    expect(chunks[0].endsWith(`${'palabra'}.`)).toBe(true);
    expect(chunks[0]).not.toContain('Párrafo 3.');
  });

  it('no entra en bucle con texto sin espacios y respeta opciones personalizadas', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text, { size: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(chunks.join('').length).toBeGreaterThanOrEqual(5000);
  });

  it('no empieza fragmentos a mitad de palabra cuando hay espacios', () => {
    const text = Array.from({ length: 600 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = chunkText(text);
    for (const c of chunks.slice(1)) expect(c).toMatch(/^palabra\d+/);
    const words = new Set(text.split(' '));
    for (const c of chunks) for (const w of c.split(' ')) expect(words.has(w)).toBe(true);
  });

  it('normaliza saltos de línea y espacios', () => {
    expect(normalizeText('\uFEFFa\r\nb\r\n\r\n\r\n\r\nc   d\t\te')).toBe('a\nb\n\nc d e');
  });
});

describe('extracción de texto', () => {
  it('convierte HTML a texto plano quitando script, style, comentarios y etiquetas', () => {
    const html = `<!doctype html><html><head><title>Políticas &amp; normas</title><style>p{color:red}</style></head>
      <body><script>alert("x")</script><!-- oculto --><h1>Vacaciones</h1><p>Los empleados tienen 15&nbsp;d&iacute;as.</p>
      <ul><li>Uno</li><li>Dos &lt;b&gt;</li></ul><p onclick="x()">Fin&#33; &#x1F600;</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toMatch(/alert|color:red|oculto|<p|<\/|onclick/);
    expect(text).toContain('Vacaciones\n\nLos empleados tienen 15 días.');
    expect(text).toContain('Uno\nDos <b>');
    expect(text).toContain('Fin! 😀');
    expect(htmlTitle(html)).toBe('Políticas & normas');
    expect(htmlTitle('<p>sin título</p>')).toBeNull();
  });

  it('decodifica entidades en una sola pasada', () => {
    expect(decodeEntities('&amp;lt; &quot;a&quot; &#39;b&#39; &desconocida; &#0;')).toBe(
      `&lt; "a" 'b' &desconocida; &#0;`,
    );
  });

  it('lee archivos de texto según su extensión', () => {
    expect(fileToText('a.txt', Buffer.from('\uFEFFhola'))).toBe('hola');
    expect(fileToText('a.json', Buffer.from('{"a":1}'))).toBe('{\n  "a": 1\n}');
    expect(fileToText('a.html', Buffer.from('<p>Hola</p><p>Mundo</p>'))).toBe('Hola\n\nMundo');
    expect(() => fileToText('a.json', Buffer.from('{malo'))).toThrow('JSON');
    expect(() => fileToText('a.txt', Buffer.from([0x68, 0x00, 0x69]))).toThrow('texto');
  });
});

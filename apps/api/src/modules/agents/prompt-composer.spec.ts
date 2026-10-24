import { composeSystemPrompt, normalizeProfile } from './prompt-composer';

describe('composeSystemPrompt', () => {
  it('con perfil vacío y sin skills, conocimiento ni ejemplos devuelve exactamente systemPrompt', () => {
    const systemPrompt = '  Eres un asistente.\nResponde breve.  ';
    expect(composeSystemPrompt({ systemPrompt })).toBe(systemPrompt);
    expect(composeSystemPrompt({ systemPrompt, profile: {} })).toBe(systemPrompt);
    expect(
      composeSystemPrompt({
        systemPrompt,
        profile: { role: '  ', goals: [], boundaries: [''] },
        skills: [],
        knowledgeBases: [],
        examples: [],
      }),
    ).toBe(systemPrompt);
    expect(composeSystemPrompt({ systemPrompt: '' })).toBe('');
    expect(composeSystemPrompt({ systemPrompt: null, profile: null })).toBe('');
  });

  it('compone las secciones en orden estable y en español', () => {
    const out = composeSystemPrompt({
      systemPrompt: 'Firma como Nexo.',
      profile: {
        role: 'Asistente de soporte',
        goals: ['Resolver dudas'],
        responsibilities: ['Atender tickets'],
        boundaries: ['Prometer reembolsos', 'No compartas datos personales'],
        tone: 'Cordial',
        outputFormat: 'Markdown breve',
        language: 'español',
      },
      skills: [{ name: 'Facturación', slug: 'facturacion', description: 'Dudas de facturas' }],
      knowledgeBases: [{ name: 'Políticas', description: 'Manual interno' }],
      examples: [{ input: '¿Horario?', output: 'De 9 a 18 h.' }],
    });
    const titles = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(titles).toEqual([
      'Rol',
      'Objetivos',
      'Responsabilidades',
      'Límites',
      'Tono y formato',
      'Idioma',
      'Instrucciones adicionales',
      'Habilidades disponibles',
      'Conocimiento',
      'Ejemplos',
    ]);
    expect(out).toContain('- No debes prometer reembolsos');
    expect(out).toContain('- No compartas datos personales');
    expect(out).toContain('Tono: Cordial\nFormato de salida: Markdown breve');
    expect(out).toContain('Responde siempre en español.');
    expect(out).toContain('## Instrucciones adicionales\nFirma como Nexo.');
    expect(out).toContain('**Facturación** (`facturacion`): Dudas de facturas');
    expect(out).toContain('`load_skill`');
    expect(out).toContain('`search_knowledge`');
    expect(out).toContain('- Políticas: Manual interno');
    expect(out).toContain('### Ejemplo 1\nEntrada:\n¿Horario?\n\nSalida esperada:\nDe 9 a 18 h.');
  });

  it('solo incluye la instrucción de save_knowledge cuando hay bases escribibles', () => {
    const base = { systemPrompt: 'Base', knowledgeBases: [{ name: 'Clientes', description: 'Perfiles' }] };
    const readOnly = composeSystemPrompt(base);
    expect(readOnly).toContain('`search_knowledge`');
    expect(readOnly).not.toContain('save_knowledge');

    const writable = composeSystemPrompt({ ...base, canWrite: true });
    expect(writable).toContain('`save_knowledge`');
    expect(writable).toContain('Puedes recordar información duradera');
    // Sin bases, canWrite no agrega nada.
    expect(composeSystemPrompt({ systemPrompt: 'Base', canWrite: true })).not.toContain('save_knowledge');
  });

  it('omite secciones vacías y no agrega "Instrucciones adicionales" si systemPrompt está vacío', () => {
    const out = composeSystemPrompt({ systemPrompt: '', profile: { role: 'Analista' } });
    expect(out).toBe('## Rol\nAnalista');
    const onlyTone = composeSystemPrompt({ systemPrompt: 'Base', profile: { outputFormat: 'JSON' } });
    expect(onlyTone).toBe('## Tono y formato\nFormato de salida: JSON\n\n## Instrucciones adicionales\nBase');
  });

  it('solo con skills incluye systemPrompt como instrucciones adicionales y la indicación de load_skill', () => {
    const out = composeSystemPrompt({
      systemPrompt: 'Base',
      skills: [{ name: 'Ventas', slug: 'ventas', description: 'Cotizar' }],
    });
    expect(out.startsWith('## Instrucciones adicionales\nBase\n\n## Habilidades disponibles\n')).toBe(true);
    expect(out).toContain('load_skill');
  });

  it('es determinista: el orden de skills y bases no depende del orden de entrada', () => {
    const a = composeSystemPrompt({
      systemPrompt: 'x',
      skills: [
        { name: 'B', slug: 'b', description: 'b' },
        { name: 'A', slug: 'a', description: 'a' },
      ],
      knowledgeBases: [{ name: 'Zeta' }, { name: 'Alfa' }],
    });
    const b = composeSystemPrompt({
      systemPrompt: 'x',
      skills: [
        { name: 'A', slug: 'a', description: 'a' },
        { name: 'B', slug: 'b', description: 'b' },
      ],
      knowledgeBases: [{ name: 'Alfa' }, { name: 'Zeta' }],
    });
    expect(a).toBe(b);
    expect(a.indexOf('(`a`)')).toBeLessThan(a.indexOf('(`b`)'));
    expect(a.indexOf('- Alfa')).toBeLessThan(a.indexOf('- Zeta'));
  });

  it('descarta ejemplos incompletos', () => {
    const out = composeSystemPrompt({ systemPrompt: '', examples: [{ input: 'hola', output: ' ' }] });
    expect(out).toBe('');
  });
});

describe('normalizeProfile', () => {
  it('ignora valores no objeto, campos desconocidos y entradas vacías', () => {
    expect(normalizeProfile(null)).toEqual({});
    expect(normalizeProfile([])).toEqual({});
    expect(normalizeProfile('rol')).toEqual({});
    expect(normalizeProfile({ role: ' Rol ', goals: ['a', '', 3], extra: 'x', tone: 5 })).toEqual({
      role: 'Rol',
      goals: ['a'],
    });
  });
});

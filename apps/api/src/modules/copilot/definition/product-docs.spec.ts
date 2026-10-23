import { loadProductDocs, ProductDocsIndex, splitSections, tokenize } from './product-docs';
import { buildCopilotSystem, COPILOT_INSTRUCTIONS, COPILOT_MARKER, COPILOT_VERSION } from './copilot.definition';

describe('base de conocimiento del producto', () => {
  const docs = loadProductDocs();
  const index = new ProductDocsIndex(docs);

  it('carga todos los documentos de definition/knowledge', () => {
    expect(docs.length).toBeGreaterThanOrEqual(12);
    for (const d of docs) expect(d.title.length).toBeGreaterThan(2);
    expect(index.size).toBeGreaterThan(docs.length);
  });

  it('tokeniza sin acentos ni palabras vacías', () => {
    expect(tokenize('¿Cómo configuro las Rutinas programadas?')).toEqual(['configuro', 'rutina', 'programada']);
  });

  it('divide por secciones ##', () => {
    const sections = splitSections({
      id: 'x',
      title: 'Doc',
      content: '# Doc\nIntro\n## Uno\nTexto 1\n## Dos\nTexto 2',
    });
    expect(sections.map((s) => s.heading)).toEqual(['Doc', 'Uno', 'Dos']);
  });

  it.each([
    ['¿Cómo conecto una base de datos en mi red privada?', '06-base-de-datos-y-edge'],
    ['cupo del copilot presupuesto', '10-presupuestos-y-costos'],
    ['quién puede ver mi agente personal compartir', '11-visibilidad'],
    ['requisitos para lanzar un agente puntaje de salud', '12-salud-y-lanzamiento'],
    ['load_skill divulgación progresiva', '03-skills'],
    ['juez IA casos de evaluación', '09-entrenamiento-supervisado'],
  ])('"%s" → %s', (query, docId) => {
    const hits = index.search(query, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.docId)).toContain(docId);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('consulta vacía o sin términos útiles no devuelve resultados', () => {
    expect(index.search('')).toEqual([]);
    expect(index.search('de la que')).toEqual([]);
  });
});

describe('definición del Copilot', () => {
  it('el system prompt lleva marcador, modo, contexto delimitado y versión', () => {
    const system = buildCopilotSystem({ mode: 'IMPROVE', agentId: 'ag_1', context: 'Plantilla logística' });
    expect(system.startsWith(COPILOT_MARKER)).toBe(true);
    expect(system).toContain('Modo actual: IMPROVE');
    expect(system).toContain('Agente en foco (agentId): ag_1');
    expect(system).toContain('<contexto_usuario>\nPlantilla logística\n</contexto_usuario>');
    expect(system).toContain(COPILOT_VERSION);
  });

  it('las instrucciones cubren las prácticas clave', () => {
    for (const fragment of [
      'máximo 5 preguntas',
      'Límites explícitos',
      'Herramientas mínimas',
      'Aprobación humana',
      'al menos 5',
      'idioma',
    ]) {
      expect(COPILOT_INSTRUCTIONS).toContain(fragment);
    }
  });
});

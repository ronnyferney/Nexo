/** Plantillas de inicio por industria para la entrevista del Copilot (ADR 0006 D5, «Primeros pasos»). */
export interface IndustryTemplate {
  id: string;
  label: string;
  summary: string;
  icon: string;
  /** Contexto que recibe la sesión `CREATE` del Copilot. */
  context: string;
  /** Primeros mensajes sugeridos. */
  starters: string[];
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'logistics',
    label: 'Logística / TMS',
    summary: 'Seguimiento de envíos, novedades de entrega, citas de cargue y transportistas.',
    icon: 'truck',
    context:
      'Industria: logística y transporte (TMS). Casos típicos: consultar el estado de envíos y guías, gestionar novedades ' +
      'de entrega, agendar citas de cargue y descargue, comunicar retrasos al cliente y apoyar a los coordinadores de ' +
      'tráfico. Sistemas habituales: TMS, WMS, rastreo GPS y correo. Las acciones con efecto (reprogramar, anular) ' +
      'requieren aprobación humana.',
    starters: [
      'Quiero un agente que informe a los clientes el estado de sus envíos consultando nuestro TMS',
      'Necesito un agente que gestione las novedades de entrega y avise al cliente',
      'Quiero un asistente para que los coordinadores agenden citas de cargue',
    ],
  },
  {
    id: 'sales',
    label: 'Comercial',
    summary: 'Calificación de prospectos, cotizaciones y seguimiento de oportunidades.',
    icon: 'wallet',
    context:
      'Área: comercial y ventas. Casos típicos: calificar prospectos, recomendar productos o planes, preparar ' +
      'cotizaciones con precios vigentes, registrar oportunidades en el CRM y hacer seguimiento. No debe inventar ' +
      'precios ni descuentos.',
    starters: [
      'Quiero un agente que califique prospectos que llegan por la web y los registre en el CRM',
      'Necesito un asistente que prepare cotizaciones con nuestra lista de precios',
      'Quiero un agente que haga seguimiento a oportunidades sin actividad',
    ],
  },
  {
    id: 'support',
    label: 'Soporte',
    summary: 'Atención de incidencias, preguntas frecuentes y escalamiento a personas.',
    icon: 'headset',
    context:
      'Área: soporte y servicio al cliente. Casos típicos: responder preguntas frecuentes con la base de conocimiento, ' +
      'consultar tickets y pedidos, guiar pasos de solución y escalar a una persona con un resumen. No comparte ' +
      'información de otros clientes ni hace reembolsos sin aprobación.',
    starters: [
      'Quiero un agente de soporte que responda con nuestra base de conocimiento y escale los casos difíciles',
      'Necesito un asistente que consulte el estado de los tickets de un cliente',
      'Quiero un agente que clasifique y priorice las solicitudes entrantes',
    ],
  },
];

/** Inicio sin plantilla: el Copilot entrevista desde cero. */
export const BLANK_TEMPLATE: IndustryTemplate = {
  id: 'blank',
  label: 'Otro caso',
  summary: 'Cuéntele al Copilot qué necesita y él le hará las preguntas.',
  icon: 'sparkles',
  context: '',
  starters: [
    'Quiero un agente que me ayude con una tarea repetitiva de mi equipo',
    '¿Qué tipo de agentes puedo crear con los conectores que ya tengo?',
  ],
};

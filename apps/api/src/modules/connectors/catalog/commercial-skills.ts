/**
 * Kit comercial (ADR 0005, D2): skills reutilizables (ADR 0003) que cualquier agente puede cargar con `load_skill`.
 * Hablan de "la herramienta de enriquecimiento" y "el CRM conectado" de forma genérica: funcionan con Lusha,
 * HubSpot, Salesforce, Pipedrive u otros conectores que el workspace instale.
 */
export interface StarterSkill {
  name: string;
  description: string;
  instructions: string;
}

export const COMMERCIAL_SKILLS: readonly StarterSkill[] = [
  {
    name: 'Prospección comercial',
    description:
      'Úsala para encontrar y preparar prospectos nuevos que encajen con el perfil de cliente ideal (ICP) antes de contactarlos.',
    instructions: `# Prospección comercial

## Objetivo
Construir una lista corta de prospectos con datos verificados y un motivo concreto para contactarlos.

## Pasos
1. **Aclara el ICP** si no está definido: industria, país/ciudad, tamaño (empleados o ingresos), cargos objetivo y
   problema que resolvemos. Si falta información crítica, pregunta antes de buscar.
2. **Revisa el CRM conectado primero**: busca la empresa y las personas. Si ya existen, no las dupliques; informa su
   estado (dueño, etapa, última actividad).
3. **Enriquece con la herramienta de enriquecimiento** solo a los prospectos que pasen el filtro del ICP. Cada consulta
   consume créditos: no repitas búsquedas de la misma persona o empresa.
4. **Prioriza** cada prospecto como A (encaje alto y señal de compra), B (encaje alto sin señal) o C (encaje parcial).
   Señales de compra: contratación en el área, expansión, financiación, cambio de cargo reciente, tecnología usada.
5. **Propón el primer contacto**: canal sugerido, gancho personalizado en 1–2 frases basado en un dato real y
   siguiente paso concreto.

## Reglas
- Nunca inventes correos, teléfonos ni datos de empresa: si la herramienta no los devuelve, indica "no disponible".
- Respeta la protección de datos: usa solo datos profesionales y para fines comerciales legítimos.
- No crees registros en el CRM sin confirmación del usuario, salvo que el flujo lo indique explícitamente.

## Formato de salida
Tabla con: prioridad, nombre, cargo, empresa, motivo (señal), dato de contacto disponible, ¿existe en el CRM? y
siguiente paso.`,
  },
  {
    name: 'Calificación de leads (BANT)',
    description:
      'Úsala para calificar un lead entrante o existente con el marco BANT (presupuesto, autoridad, necesidad y tiempo) y decidir el siguiente paso.',
    instructions: `# Calificación de leads (BANT)

## Objetivo
Asignar una calificación objetiva y explicable a un lead y recomendar qué hacer con él.

## Pasos
1. **Reúne contexto**: lee el mensaje o formulario del lead, busca a la persona y su empresa en el CRM conectado y,
   si faltan datos firmográficos clave, consulta la herramienta de enriquecimiento (una sola vez por lead).
2. **Evalúa cada criterio de 0 a 3** con evidencia explícita:
   - **B – Presupuesto**: ¿hay presupuesto o capacidad de pago (tamaño, ingresos, menciones de inversión)?
   - **A – Autoridad**: ¿la persona decide o influye (cargo, área)? ¿Quién más participa?
   - **N – Necesidad**: ¿el problema descrito coincide con lo que resolvemos? ¿Es urgente o doloroso?
   - **T – Tiempo**: ¿hay fecha, evento o plazo que impulse la decisión?
   Si no hay evidencia, puntúa 0 y anota la pregunta que la obtendría. No supongas.
3. **Calcula el total (0–12)** y clasifica: 9–12 **caliente** (pasar a ventas hoy), 5–8 **tibio** (nutrir y agendar
   descubrimiento), 0–4 **frío** (secuencia de nutrición o descartar con motivo).
4. **Recomienda el siguiente paso** y, si el flujo lo permite, actualiza el estado del lead en el CRM conectado y
   registra una nota con el resumen de la calificación.

## Formato de salida
- Puntaje por criterio con su evidencia (una línea cada uno) y total.
- Clasificación, riesgos principales y 3 preguntas de descubrimiento para cerrar los vacíos.
- Siguiente paso concreto con responsable y plazo sugerido.`,
  },
  {
    name: 'Seguimiento de oportunidades',
    description:
      'Úsala para revisar el pipeline, detectar oportunidades estancadas o en riesgo y proponer acciones de seguimiento concretas.',
    instructions: `# Seguimiento de oportunidades

## Objetivo
Mantener el pipeline sano: ninguna oportunidad sin próximo paso, fecha de cierre realista ni dueño claro.

## Pasos
1. **Consulta el CRM conectado**: oportunidades abiertas (o las del vendedor/cuenta indicados) con etapa, monto, fecha
   de cierre, próximo paso y última actividad.
2. **Marca alertas** por oportunidad:
   - Sin actividad en más de 14 días o sin próximo paso definido.
   - Fecha de cierre vencida o que cambió varias veces.
   - Etapa avanzada sin decisor identificado o sin propuesta enviada.
   - Monto atípico para el segmento.
3. **Revisa los contactos clave** de las oportunidades en riesgo: si el decisor dejó de responder o cambió de cargo,
   usa la herramienta de enriquecimiento (una vez por persona) para confirmar su situación o identificar a quien lo
   reemplazó.
4. **Prioriza** por impacto (monto × probabilidad) y urgencia (cercanía del cierre).
5. **Propón una acción por oportunidad**: mensaje de seguimiento redactado, reunión a agendar, actualización de etapa o
   fecha, o cierre como perdida con motivo.
6. **Ejecuta solo lo autorizado**: registra notas o actualiza campos en el CRM conectado únicamente si el usuario lo
   confirma o el flujo lo define. Nunca cambies montos o etapas por suposición.

## Formato de salida
Resumen del pipeline (total, ponderado, nº en riesgo) y tabla: oportunidad, cuenta, etapa, monto, cierre, alerta,
acción propuesta. Termina con las 3 acciones más importantes de la semana.`,
  },
  {
    name: 'Preparación de reunión',
    description:
      'Úsala antes de una reunión comercial para preparar un brief de la cuenta y los asistentes, objetivos, preguntas y posibles objeciones.',
    instructions: `# Preparación de reunión

## Objetivo
Que quien vende llegue a la reunión en 5 minutos de lectura con contexto, objetivo y plan claros.

## Pasos
1. **Identifica la reunión**: cuenta, asistentes (nombre y cargo), fecha y propósito. Si falta algo esencial, pregunta.
2. **Historial en el CRM conectado**: oportunidades abiertas y su etapa, últimas notas y actividades, compras previas y
   compromisos pendientes.
3. **Contexto externo**: con la herramienta de enriquecimiento obtén datos de la empresa (industria, tamaño, ubicación)
   y de los asistentes (cargo, antigüedad) solo si no están ya en el CRM.
4. **Define el objetivo de la reunión** (p. ej., validar necesidad, presentar propuesta, acordar piloto) y el resultado
   mínimo aceptable.
5. **Prepara** 5–7 preguntas de descubrimiento, 2–3 objeciones probables con su respuesta, y la propuesta de
   siguiente paso a pedir al final.

## Reglas
- Distingue hechos (con fuente: CRM o enriquecimiento) de hipótesis.
- No envíes invitaciones ni correos a menos que el usuario lo solicite.

## Formato de salida
Brief con secciones: Resumen de la cuenta · Asistentes · Historial · Objetivo · Preguntas · Objeciones y respuestas ·
Siguiente paso propuesto.`,
  },
];

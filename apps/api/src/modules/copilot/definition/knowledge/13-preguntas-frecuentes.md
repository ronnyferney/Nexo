# Preguntas frecuentes

## ¿El Copilot cambia mis agentes?
No. El Copilot solo crea propuestas. Tú revisas el detalle y pulsas Aplicar; lo que se crea (agentes, skills, casos,
ejemplos, rutinas) te pertenece.

## ¿Cuánto cuesta usar el Copilot?
Nada para tu presupuesto: lo paga Nexo con un cupo mensual por workspace. Cuando el cupo se agota puedes seguir usando
el puntaje de salud y las plantillas hasta el mes siguiente.

## ¿Por qué mi agente inventa respuestas?
Suele faltar conocimiento o un límite explícito. Carga las políticas en una base de conocimiento, agrega el límite
"no inventar datos; si no encuentras la información, dilo" y crea casos de evaluación que lo verifiquen.

## ¿Por qué mi agente no usa una herramienta?
Revisa que la operación esté vinculada al agente, que su descripción explique cuándo usarla y que el esquema de entrada
sea claro. Si requiere aprobación, el agente pedirá confirmación antes de ejecutarla.

## ¿Por qué recibo el error 402?
Se agotó el presupuesto de IA de tu unidad o de una unidad superior con política BLOCK. Un administrador puede ampliar
el presupuesto o configurar la degradación a un modelo económico.

## ¿Por qué mi rutina no se ejecuta?
Las rutinas solo se ejecutan si el agente está lanzado y la rutina está habilitada. Revisa la expresión cron y la zona
horaria, y el historial de ejecuciones para ver errores.

## ¿Cómo conecto una base de datos de mi red interna?
Instala Nexo Edge en tu red y crea un conector de base de datos en modo Edge con consultas declaradas.

## ¿Qué modelo elijo?
Empieza con el recomendado; para tareas simples y de alto volumen usa un modelo ECONOMY y esfuerzo bajo. Mide con tus
casos de evaluación antes y después de cambiar.

## ¿Quién puede ver mi agente?
Por defecto solo tú (personal). Puedes compartirlo con personas o unidades, o con toda la empresa cuando esté lanzado.

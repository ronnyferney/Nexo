# Qué es Nexo

## Resumen
Nexo es una plataforma para construir agentes de IA, conectarlos con los sistemas de la empresa (APIs REST, SOAP,
GraphQL, servidores MCP y bases de datos) y automatizar procesos con flujos. Cada empresa trabaja en su propio
workspace: agentes, conectores, conocimiento, flujos, presupuestos y miembros están aislados por workspace.

## Piezas principales
- **Agentes**: asistentes con un perfil (rol, objetivos, límites, tono), un modelo de IA, herramientas (operaciones de
  conectores), skills, bases de conocimiento, ejemplos, casos de evaluación y rutinas.
- **Conectores**: integraciones con sistemas externos. Cada operación de un conector puede usarse como herramienta de
  un agente o como paso de un flujo. El catálogo trae integraciones listas para instalar con un clic.
- **Flujos**: automatizaciones como grafo de nodos (disparadores, conectores, agentes, condiciones, bucles, sub-flujos).
- **Gobierno de IA**: proveedores y modelos permitidos, unidades corporativas, presupuestos en dólares y medición de consumo.
- **Nexo Copilot**: el asistente que te ayuda a diseñar, mejorar y diagnosticar agentes. Nunca cambia nada sin que
  apliques su propuesta.

## Roles del workspace
- **OWNER / ADMIN**: administran proveedores de IA, organización, presupuestos, secretos y ajustes del workspace.
- **EDITOR**: crea y comparte agentes, conectores y flujos.
- **VIEWER**: usa lo que le comparten; puede crear agentes personales si el workspace lo permite.

## Ciclo recomendado para un agente exitoso
1. Diseñar con el Copilot (entrevista) o desde una plantilla.
2. Conectar los sistemas necesarios y cargar el conocimiento.
3. Crear al menos 5 casos de evaluación y evaluar.
4. Mejorar con el feedback y las sugerencias hasta alcanzar la meta de puntaje.
5. Lanzar el agente (salud ≥ 70 y evaluación ≥ meta) y compartirlo con el equipo o la empresa.

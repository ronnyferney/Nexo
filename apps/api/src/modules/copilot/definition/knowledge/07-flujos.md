# Flujos de automatización

## Qué son
Un flujo es un grafo dirigido de nodos: disparadores (manual, webhook, programado, desde un agente o MCP), llamadas a
conectores, nodos de agente, condiciones, transformaciones, bucles y sub-flujos. Las ejecuciones se procesan en colas.

## Prácticas incluidas
- **Flujo de error**: si una ejecución falla se dispara el flujo de error configurado con los datos del fallo.
- **Sub-flujos** (profundidad máxima 5) y **bucles** sobre listas (hasta 1.000 elementos, concurrencia 1–10).
- **Historial de versiones**: cada cambio guarda la versión anterior; restaurar crea una versión nueva.
- **Probar un nodo** con datos fijados sin ejecutar todo el flujo.
- **Retención** de ejecuciones (30 días por defecto).

## Agentes dentro de flujos
Un nodo agente solo puede usar agentes que el editor del flujo puede usar. Úsalo para pasos que requieren criterio
(clasificar, resumir, redactar); usa nodos deterministas para lo demás (más barato y predecible).

## Agente o flujo
- Proceso con pasos fijos y reglas claras → flujo.
- Conversación, criterio o lenguaje natural → agente.
- Mezcla → flujo que llama a un agente en el paso que requiere criterio.

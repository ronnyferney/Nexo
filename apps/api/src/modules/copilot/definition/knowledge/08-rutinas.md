# Rutinas programadas

## Qué son
Una rutina es una tarea recurrente de un agente: nombre, instrucción, expresión cron de 5 campos y zona horaria.
Opcionalmente notifica el resultado a un webhook. Cada ejecución queda en el historial con estado, salida, error,
costo y duración.

## Reglas
- Solo se ejecutan las rutinas de agentes **lanzados**.
- El consumo se imputa al centro de costo del agente (o del dueño si es personal).
- Gestionarlas requiere permiso de edición sobre el agente.
- Las rutinas que sugiere el Copilot se crean **deshabilitadas**: revísalas y habilítalas cuando el agente esté listo.

## Ejemplos de cron
- `0 8 * * 1-5`: días hábiles a las 8:00.
- `0 */4 * * *`: cada 4 horas.
- `30 18 * * 5`: viernes a las 18:30.

## Buenas prácticas
Instrucción autocontenida (la rutina no tiene conversación previa), formato de salida definido y aprobación humana
para acciones con efecto (en una rutina nadie aprueba en vivo: evita operaciones de escritura sin supervisión).

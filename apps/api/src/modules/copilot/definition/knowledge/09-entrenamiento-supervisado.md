# Entrenamiento supervisado y evaluaciones

## Bucle de mejora
Conversar → calificar (👍/👎 y corrección) → revisar en la bandeja de supervisión → convertir en ejemplos y casos de
evaluación → evaluar → aplicar sugerencias aprobadas → publicar la mejor versión.

## Casos de evaluación
Cada caso tiene entrada, respuesta esperada (opcional), criterios (rúbrica) y etiquetas. Se recomienda tener **al menos
5 casos desde el primer día**: casos felices, casos límite, una petición fuera de alcance y una que requiera aprobación.

## Corridas de evaluación
Ejecutan el agente sobre todos los casos y un **juez IA** califica cada salida de 0 a 1 (umbral de aprobación 0.7 por
defecto). Los puntajes dudosos (0.4–0.8) quedan para revisión humana; el puntaje humano prevalece. Las evaluaciones
consumen tokens del presupuesto del cliente.

## Meta, versiones y sugerencias
- `targetScore` (0.85 por defecto) indica cuándo el agente alcanzó su meta.
- Las versiones guardan instantáneas de la configuración; cada corrida registra la versión evaluada.
- Las sugerencias de mejora las genera la IA a partir de los casos fallidos y solo se aplican con aprobación humana.

# Presupuestos y costos

## Medición
Cada llamada a un modelo registra tokens y costo en dólares (según las tarifas del catálogo) por workspace, unidad,
usuario, agente y origen (chat, flujo, MCP, rutina, evaluación, Copilot). No se guarda el contenido de los mensajes.

## Unidades y presupuestos
- La organización es un árbol de unidades con una raíz. El chat de un usuario se imputa a su unidad; las ejecuciones
  sin usuario al centro de costo del agente o a la raíz.
- Cada unidad puede tener un presupuesto mensual, trimestral o anual en dólares. Es jerárquico: el consumo descuenta de
  la unidad y de todos sus ancestros.
- Políticas al agotarse: BLOCK (rechaza con error 402), DOWNGRADE (usa el modelo económico configurado) o ALERT_ONLY.
- Alertas al cruzar umbrales (50, 80 y 100 % por defecto).
- Las unidades pueden restringir los modelos permitidos.

## Cómo reducir costos
- Modelos ECONOMY para tareas simples y de alto volumen; esfuerzo bajo cuando no se requiere razonamiento.
- Conocimiento y skills en lugar de instrucciones largas (prompts más cortos, caché de prompts más eficaz).
- Pocas herramientas y turnos máximos acotados.
- Degradación automática (DOWNGRADE) en áreas de alto volumen.

## Cupo del Copilot
El uso del Nexo Copilot lo paga Nexo con un cupo mensual por workspace (2 USD por defecto) y **no descuenta** de los
presupuestos del cliente. Al agotarse, siguen disponibles el puntaje de salud y las plantillas.

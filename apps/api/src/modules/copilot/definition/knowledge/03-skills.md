# Skills (habilidades)

## Qué son
Una skill es un procedimiento reutilizable: nombre, descripción de cuándo usarla, instrucciones completas en Markdown y,
opcionalmente, operaciones de conector que aporta como herramientas. Se pueden asignar a varios agentes.

## Divulgación progresiva
En las instrucciones del agente solo aparecen el nombre y la descripción de cada skill. El agente carga las
instrucciones completas con la herramienta interna `load_skill` cuando las necesita. Esto ahorra tokens (costo) y
mantiene el prompt corto.

## Buenas prácticas
- Una skill por procedimiento (por ejemplo "Calificar un lead con BANT", "Registrar una novedad de transporte").
- Descripción orientada a decidir cuándo usarla: "Úsala cuando el cliente pida…".
- Instrucciones con pasos numerados, datos que necesita, formato de salida y qué hacer si falta información.
- Asocia solo las operaciones que la skill realmente usa.

## Skills comerciales incluidas
El kit comercial del catálogo instala skills de prospección, calificación BANT, seguimiento de oportunidades y
preparación de reuniones.

## Quién puede crearlas
Las skills son recursos del workspace: crearlas, editarlas o instalar el kit comercial exige rol EDITOR o superior.
Un VIEWER puede vincular skills existentes a sus agentes personales; si aplica una propuesta del Copilot que incluye
skills nuevas, el resto de la propuesta se aplica, las skills nuevas se omiten y se le indica que pida a un editor que
las cree.

# Bases de conocimiento

## Qué son
Una base de conocimiento agrupa documentos de la empresa (políticas, procedimientos, catálogos, preguntas frecuentes).
Se cargan como texto, URL o archivo (.txt, .md, .csv, .json, .html; máximo 5 MB) y se dividen en fragmentos de unos
1.200 caracteres.

## Cómo la usa el agente
Si el agente tiene bases asignadas recibe la herramienta interna `search_knowledge`, que busca por texto completo y
devuelve los fragmentos más relevantes con el título del documento. El agente debe buscar antes de responder sobre
temas de la empresa.

## Conocimiento antes que instrucciones largas
Es mejor cargar las políticas en una base de conocimiento que pegarlas en las instrucciones: el prompt queda corto, la
información se actualiza sin tocar el agente y el modelo solo lee lo relevante (menor costo).

## Buenas prácticas
- Documentos con títulos claros y un tema por documento.
- Mantén las bases actualizadas; elimina versiones obsoletas para evitar respuestas contradictorias.
- Agrega casos de evaluación que verifiquen que el agente cita la política correcta.

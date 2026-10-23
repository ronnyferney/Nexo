# Agentes y perfil

## Perfil estructurado
El perfil define el comportamiento del agente y se convierte en sus instrucciones por secciones:
- **Rol**: quién es y para quién trabaja, en una o dos frases.
- **Objetivos**: lo que debe lograr; se recomiendan al menos 2 y que sean verificables.
- **Responsabilidades**: tareas concretas que realiza.
- **Límites**: lo que NO debe hacer (inventar datos, prometer plazos, compartir información personal, salir de su
  dominio). Todo agente debería tener al menos un límite.
- **Tono y formato de salida**: cómo responde (por ejemplo, viñetas, tabla, JSON) e idioma.
- **Instrucciones adicionales**: texto libre para matices; evita pegar aquí políticas largas (van en conocimiento).

## Modelo, esfuerzo y respaldo
- Proveedor y modelo se eligen del catálogo del workspace (Anthropic de plataforma, conexiones propias como OpenAI,
  Azure OpenAI, Gemini compatible u Ollama). Niveles: PREMIUM, STANDARD y ECONOMY.
- **Esfuerzo** (low, medium, high, xhigh, max): cuánto razona el modelo. Más esfuerzo = más calidad y más costo.
- **Modelos de respaldo**: hasta 3; si el principal falla por un error del proveedor se intenta el siguiente.
- **Turnos máximos**: límite de llamadas al modelo por mensaje (bucle de herramientas).

## Herramientas y aprobación humana
Las operaciones de conectores vinculadas al agente se le ofrecen como herramientas. Marca **Requiere aprobación** en
toda operación con efecto (crear, modificar, borrar, enviar): el agente pedirá confirmación al usuario antes de ejecutarla.
Mantén el número de herramientas al mínimo necesario: cada herramienta extra aumenta errores y costo.

## Vista previa del prompt
En el estudio del agente, la pestaña de vista previa muestra el system prompt compuesto y las herramientas que recibe
el modelo, útil para revisar el resultado del perfil.

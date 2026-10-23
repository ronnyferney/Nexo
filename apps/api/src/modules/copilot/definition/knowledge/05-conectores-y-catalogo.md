# Conectores y catálogo de integraciones

## Conectores
Un conector representa un sistema externo: API REST (importable desde OpenAPI), servicio SOAP (WSDL), endpoint
GraphQL, servidor MCP o base de datos. Cada conector tiene operaciones con un esquema de entrada; cada operación puede
ser herramienta de un agente o paso de un flujo.

## Credenciales y seguridad
Las credenciales se guardan cifradas en la bóveda de secretos del workspace y se referencian como
`{{ secrets.NOMBRE }}`; nunca se escriben en el conector. Toda llamada saliente pasa por controles de seguridad
(bloqueo de redes internas, tiempo máximo y tamaño de respuesta).

## Catálogo ("instalar con un clic")
Instalar una integración del catálogo crea los secretos en la bóveda, el conector y sus operaciones prediseñadas con
descripciones pensadas para agentes. Las operaciones de escritura se marcan como "acción con efecto" y, al usarlas un
agente, quedan con aprobación humana. Instalar exige rol EDITOR; si la bóveda ya tiene credenciales de esa integración
con otro valor, solo un ADMIN u OWNER puede reemplazarlas (un EDITOR recibe un aviso y no se escribe nada). Reinstalar
con las mismas credenciales sí está permitido (por ejemplo, otra instancia del conector con la misma cuenta).

Integraciones disponibles, por categoría:

- **Prospección**
  - **Lusha (MCP)**: servidor MCP oficial de Lusha; al instalar se importan sus tools (búsqueda de prospectos y
    enriquecimiento de personas y empresas). Requiere la API key.
  - **Lusha (API REST)**: enriquecer persona y empresa (correo, teléfono, cargo, firmográficos) con API key.
- **CRM**
  - **HubSpot CRM**: buscar contactos y empresas; crear y actualizar contactos, crear negocios y notas. Token de app
    privada u OAuth2.
  - **Salesforce**: consultar leads y oportunidades, crear leads y oportunidades (OAuth2 con la cuenta del usuario).
  - **Pipedrive**: buscar personas, crear personas y tratos, agregar notas (token de API y dominio de la empresa).
- **Google (OAuth2 con la cuenta del usuario)**
  - **Google Sheets**: leer rangos y agregar filas.
  - **Gmail (envío)**: solo enviar correos; no lee la bandeja.
  - **Gmail (bandeja y respuestas)**: buscar y leer correos, listar etiquetas, crear borradores (también de respuesta),
    enviar y responder en hilos. Elija esta si el agente debe leer o responder correos.
  - **Google Calendar**: calendarios, eventos y disponibilidad; crear (con Google Meet opcional), modificar y cancelar
    eventos.
  - **Google Meet**: crear salas de Meet y consultar reuniones pasadas, asistentes y transcripciones.
- **Microsoft 365 (Microsoft Graph, OAuth2)**
  - **Microsoft 365 Outlook**: enviar correos y crear eventos de calendario.
  - **Microsoft 365 Correo (bandeja)**: supervisar el buzón: listar y leer correos, marcarlos como leídos o para
    seguimiento, moverlos de carpeta y dejar borradores de respuesta para que una persona los revise; no envía correos.
  - **Calendario corporativo (Microsoft 365)**: agenda, disponibilidad de personas y sugerencia de horarios; crear,
    mover y cancelar reuniones (con Teams). Cuentas de trabajo o escuela.
  - **Microsoft To Do**: listas y tareas personales; crear recordatorios de seguimiento y completarlos (cuentas
    personales y de trabajo).
  - **Microsoft Planner**: planes, buckets y tareas de equipo; crear, asignar, actualizar y completar tareas (solo
    cuentas de trabajo o escuela).
  - **Microsoft Teams**: publicar en canales y chats y crear enlaces de reunión en línea (solo cuentas de trabajo o
    escuela).
- **Mensajería y redes**
  - **LinkedIn**: publicar como persona o como página de empresa (OAuth2). La API de LinkedIn no permite prospectar
    personas: para eso combine con Lusha.
  - **WhatsApp Business (Cloud API)**: enviar mensajes de plantilla y de texto (token de acceso y phone number ID).
  - **Slack**: publicar, programar y editar mensajes (texto o Block Kit), responder en hilos, reaccionar, abrir mensajes
    directos, unirse a canales, leer canales e hilos y buscar usuarios. Se conecta con un token de bot o con el botón
    "Agregar a Slack" (OAuth v2).

## OAuth2 de usuario
Usan OAuth2 (authorization code; con PKCE cuando el proveedor lo admite): todas las integraciones de Google (Sheets,
Gmail envío y bandeja, Calendar, Meet), todas las de Microsoft 365 (Outlook, Correo, Calendario corporativo, To Do,
Planner, Teams), Salesforce, LinkedIn, HubSpot (alternativa al token de app privada) y Slack ("Agregar a Slack",
alternativa al token de bot). Se puede usar la app OAuth de la plataforma o una app propia del cliente (client ID y
client secret). Al instalar se devuelve la URL de consentimiento; tras autorizar, los tokens se guardan cifrados y se
renuevan automáticamente cuando el proveedor entrega refresh token. Desconectar borra los tokens en Nexo.

## Orden de preferencia
1. API o servidor MCP del sistema (respeta reglas de negocio).
2. Base de datos en la nube con IP pública controlada (modo directo).
3. Base de datos en red privada mediante Nexo Edge.

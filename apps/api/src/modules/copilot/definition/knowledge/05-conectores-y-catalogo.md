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
Integraciones listas: Lusha (MCP y REST), HubSpot, Salesforce, Pipedrive, Google Sheets, Gmail, Microsoft 365 Outlook,
WhatsApp Business y Slack. Instalar crea los secretos, el conector y sus operaciones prediseñadas con descripciones
pensadas para agentes. Las operaciones de escritura se marcan como "acción con efecto".

## OAuth2 de usuario
Para Google, Microsoft, Salesforce o HubSpot se puede conectar con OAuth2 (con la app de la plataforma o una app propia
del cliente). Los tokens se cifran y se renuevan automáticamente.

## Orden de preferencia
1. API o servidor MCP del sistema (respeta reglas de negocio).
2. Base de datos en la nube con IP pública controlada (modo directo).
3. Base de datos en red privada mediante Nexo Edge.

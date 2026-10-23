# 0008. Protección de datos sensibles hacia los modelos y observabilidad de la plataforma

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect
- **Decisiones de negocio confirmadas:** política base **enmascarar con reversión**; el administrador de Nexo ve
  **métricas sin contenido** (mejor práctica) y solo accede a contenido mediante **acceso de soporte excepcional**
  autorizado por el cliente, limitado en tiempo y auditado.

## Contexto
Los usuarios entregan a los agentes información sensible (cédulas, teléfonos, cuentas, datos de clientes y del TMS) que
termina en proveedores de IA externos. Las empresas exigen control sobre qué sale, a qué modelo y con qué trazabilidad,
y la plataforma necesita observar el uso sin convertirse en un riesgo de privacidad (Ley 1581 de 2012 de Colombia y
marcos equivalentes; validar con asesoría legal).

## Principios
1. **Privacidad desde el diseño:** el dato sensible no debería llegar al modelo si no es necesario.
2. **Mínimo privilegio sobre el contenido:** Nexo opera la plataforma sin leer el contenido de sus clientes.
3. **Defensa en profundidad:** detección + política + enrutamiento por clasificación + auditoría + retención.
4. **Transparencia para el cliente:** el administrador del cliente ve qué se protegió, cuándo y por qué.

## Decisiones

### D1. Detector de datos sensibles (`DataGuard`)
Módulo puro y determinista (sin IA, sin red) que analiza texto y estructuras JSON:
- `NATIONAL_ID` (cédula colombiana, NIT con dígito de verificación, DNI/pasaporte genérico), `PAYMENT_CARD` (validación
  Luhn), `BANK_ACCOUNT`, `EMAIL`, `PHONE` (formatos CO e internacionales), `ADDRESS` (heurística), `CREDENTIAL`
  (contraseñas en contexto, API keys conocidas, JWT, llaves privadas, cadenas de conexión), `HEALTH` y `MINOR`
  (palabras clave), `CUSTOM` (patrones definidos por el cliente, con nombre y expresión validada contra ReDoS).
- Devuelve hallazgos `{ category, start, end, confidence }` sin copiar el valor fuera del proceso.

### D2. Política por empresa → unidad → agente (`DataPolicy`)
- Acción por categoría: `ALLOW` | `MASK` (enmascarar con reversión) | `BLOCK` | `ALERT`.
- Valores por defecto: todas las categorías personales `MASK`; `CREDENTIAL` **siempre `BLOCK`** (no configurable);
  `HEALTH`/`MINOR` `MASK`. La política más estricta de la cadena (agente, unidad, empresa) gana.
- **Enmascarar con reversión:** antes de enviar al modelo se reemplaza cada valor por un marcador estable dentro de la
  conversación (`[CEDULA_1]`, `[TELEFONO_2]`…). La tabla marcador→valor vive **solo en memoria del servidor durante la
  ejecución** (y cifrada en la conversación para turnos siguientes). Las respuestas del modelo y los argumentos de las
  herramientas se **restituyen** antes de mostrarse al usuario o de ejecutar la herramienta, de modo que la consulta a
  ASTRANS por cédula sigue funcionando sin que el proveedor de IA vea la cédula.
- Puntos de aplicación: mensaje del usuario, **resultados de herramientas** (REST, SOAP, GraphQL, MCP, base de datos,
  conocimiento), mensajes de rutinas, flujos, evaluaciones y Copilot.

### D3. Clasificación de datos y enrutamiento a modelos aprobados
- Niveles: `PUBLIC` < `INTERNAL` < `CONFIDENTIAL` < `RESTRICTED`.
- Cada conexión LLM declara `maxDataClass` (p. ej. Claude en la cuenta AWS del cliente u Ollama local: `RESTRICTED`;
  un modelo externo de prueba: `INTERNAL`). Conectores y bases de conocimiento declaran su `dataClass`; un agente hereda
  la clase máxima de sus herramientas y conocimiento.
- Si la clase efectiva de una ejecución supera la del modelo: se usa el **modelo aprobado** configurado para esa clase
  en la política, o se bloquea con un mensaje claro.

### D4. Contenido externo no confiable (inyección de instrucciones y exfiltración)
- Los resultados de herramientas se envían al modelo marcados como datos, no instrucciones.
- Un agente que combina herramientas que **leen contenido externo** con herramientas que **envían datos hacia afuera**
  (correo, mensajería, CRM, webhooks) exige aprobación humana para estas últimas por defecto (regla de salud ADR 0006).

### D5. Auditoría de protección de datos
- `DataProtectionEvent`: workspace, unidad, usuario, agente, canal (chat/flujo/rutina/evaluación/copilot), categoría,
  acción, cantidad, proveedor/modelo de destino, fecha. **Sin valores ni fragmentos.**
- Panel del cliente **"Protección de datos"** (ADMIN): tendencias por categoría y acción, agentes y unidades con más
  hallazgos, bloqueos, envíos a modelos por clase de dato; configuración de la política y patrones personalizados.

### D6. Observabilidad de la plataforma (administrador de Nexo)
- **Telemetría de uso del producto** sin contenido: eventos de navegación y acciones (`product_event`: nombre, pantalla,
  duración, resultado, errores), embudos de activación (registro → primer conector → primer agente → primer lanzamiento),
  adopción por función y errores de interfaz/API. Los clientes pueden excluir su workspace de la telemetría opcional;
  la telemetría operativa mínima (errores, seguridad) siempre existe.
- **Manejo de datos agregado por empresa:** conteos por categoría y acción, bloqueos, clase de datos enviada por proveedor.
- **Acceso de soporte excepcional (break-glass):** el administrador del cliente otorga a Nexo acceso de lectura a un
  recurso concreto por un tiempo limitado (máx. 72 h) con motivo; todo acceso queda auditado y visible para el cliente.

### D7. Ciclo de vida del dato
- Retención configurable de conversaciones y registros de ejecución por workspace (p. ej. 90 días) con purga diaria.
- Borrado de los datos de un usuario (derecho de supresión) y exportación.
- Fase 2: cifrado de conversaciones con llave por workspace (envelope encryption con AWS KMS).

## Contrato de API (resumen; se detalla en la implementación)
- `GET/PUT /admin/data-protection/policy` · `GET/POST/DELETE /admin/data-protection/patterns` ·
  `GET /admin/data-protection/events?from&to&groupBy` · `POST /admin/data-protection/test` `{ text }` → hallazgos y vista enmascarada.
- `PATCH /admin/llm/connections/:id` acepta `maxDataClass`; conectores y bases aceptan `dataClass`.
- `GET/PATCH /workspace/settings` agrega `conversationRetentionDays`, `productTelemetry`.
- `POST /admin/support-access` `{ scope, resourceId, hours, reason }` · `DELETE /admin/support-access/:id` · `GET /admin/support-access`.
- Plataforma (`PLATFORM_ADMIN_EMAILS`): `GET /platform/usage?from&to` (telemetría y embudos),
  `GET /platform/data-protection?from&to` (agregados por workspace), `GET /platform/support-access` (accesos vigentes).
- `POST /telemetry/events` (lote de eventos de producto desde la web; sin contenido, con validación de esquema).

## Consecuencias
- Migración: `DataPolicy`, `DataPattern`, `DataProtectionEvent`, `ProductEvent`, `SupportAccessGrant`,
  `dataClass`/`maxDataClass`, ajustes de retención y telemetría.
- Latencia adicional mínima (detección determinista en el servidor). Riesgo de falsos positivos: mitigado con
  reversión, pruebas por categoría y la herramienta de prueba de la política.
- El enmascarado puede reducir la calidad cuando el modelo necesita el dato literal; la política por agente permite
  ajustar categorías concretas a `ALLOW` de forma explícita y auditada.

## Plan
| Tarea | Dueño |
|---|---|
| Esquema y migración | orquestador |
| `DataGuard`, política, enmascarado reversible en runtime/herramientas/Copilot, clasificación y enrutamiento | nexo-backend-ai + nexo-backend-integrations |
| Auditoría, telemetría, retención, borrado, acceso de soporte, endpoints de plataforma | nexo-backend-platform |
| Panel "Protección de datos", política, prueba de política, clasificación en conexiones/conectores, telemetría web | nexo-frontend-ui + nexo-frontend-core |
| Pruebas por categoría, de reversión y de no filtración de contenido | nexo-qa-api |

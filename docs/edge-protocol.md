# Protocolo Nexo ↔ Nexo Edge

Referencia del canal entre la API de Nexo y el agente on-premise **Nexo Edge** (ADR 0005, D5). Implementación:
`apps/api/src/modules/edge/` (servidor) y `apps/edge/src/` (cliente). Tipos: `edge.protocol.ts` / `protocol.ts`.

## Transporte y autenticación

- WebSocket **saliente** desde el Edge: `GET wss://<PUBLIC_URL>/api/edge/ws` (en local `ws://localhost:3000/api/edge/ws`).
- Cabecera del handshake: `Authorization: Bearer nexoedge_<aleatorio>`. Nexo busca el SHA-256 del token en
  `EdgeAgent.tokenHash`. Token ausente o inválido → respuesta HTTP `401` **antes** de abrir el socket.
- Servidor: `WebSocketServer({ noServer: true })` de `ws` enganchado al evento `upgrade` del servidor HTTP de Nest
  (no requiere adaptador de WebSockets ni cambios en `main.ts`; otros `upgrade` del servidor no se tocan).
- Solo frames de **texto** con un objeto JSON que tiene `type`. Máximo 16 MB por mensaje. Un frame binario o JSON
  inválido cierra la conexión con `4002`.

## Ciclo de vida

```
Edge                                   Nexo
 |---- upgrade + Authorization ------->|  401 si el token no es válido
 |<--------------- welcome ------------|  { type, edgeId, name }
 |---- hello ------------------------->|  actualiza EdgeAgent (version, hostname, connections, lastSeenAt)
 |---- ping (cada 15 s) -------------->|
 |<--------------- pong ---------------|
 |<------- WS ping (cada 15 s) --------|  el cliente responde con WS pong (automático)
 |<--------------- query/schema/test --|  { id, ... }
 |---- result | schema_result | test_result | error  (mismo id) --->|
```

- **Estado:** `ONLINE` si `lastSeenAt` tiene menos de 45 s; si no, `OFFLINE`. `lastSeenAt` se actualiza con el `hello`
  y con cualquier señal (mensaje, ping, pong), como máximo cada 10 s.
- **Sin señal > 45 s** → Nexo cierra el socket (`4008`). El Edge también reinicia la conexión si no recibe nada de
  Nexo durante 45 s.
- **Una conexión activa por Edge** en todo el clúster: una conexión nueva reemplaza a la anterior (`4000`), también
  si vive en otra instancia de la API (aviso por Redis `edge:control`).
- **Rotar el token o eliminar el Edge** cierra la conexión vigente (`4001`); los reintentos con el token viejo reciben `401`.
- **Reconexión del Edge:** backoff exponencial 1 s → 60 s con jitter ±20 %; tras `4000`, `4001` o `401` espera el máximo.

| Código de cierre | Significado |
|---|---|
| `1000` | Cierre normal (Edge detenido) |
| `1001` | La instancia de la API se está deteniendo |
| `4000` | Reemplazada por una conexión más nueva del mismo Edge |
| `4001` | Token rotado o Edge eliminado |
| `4002` | Mensaje inválido (binario o no JSON) |
| `4008` | Sin heartbeat |

## Mensajes del Edge → Nexo

```jsonc
// Presentación (al abrir la conexión). Solo nombres de conexión: nunca credenciales.
{ "type": "hello", "version": "1.0.0", "hostname": "srv-tms-01", "connections": ["astrans", "reportes"] }

{ "type": "ping" }
{ "type": "pong" }

// Resultado de una consulta
{ "type": "result", "id": "<id>", "durationMs": 42,
  "data": { "rows": [{ "placa": "ABC123" }], "rowCount": 1, "truncated": false,
            "fields": [{ "name": "placa", "type": "text" }] } }

// Esquema
{ "type": "schema_result", "id": "<id>", "engine": "mssql",
  "tables": [{ "schema": "dbo", "name": "vehiculos", "type": "TABLE",
               "columns": [{ "name": "placa", "type": "varchar", "nullable": false }] }] }

// Prueba de conexión
{ "type": "test_result", "id": "<id>", "engine": "mssql", "version": "Microsoft SQL Server 2019 ...", "durationMs": 12 }

// Error
{ "type": "error", "id": "<id>", "code": "POLICY" | "DB" | "CONNECTION" | "BAD_REQUEST", "message": "..." }
```

Reglas de `hello`: `version` ≤ 50 caracteres, `hostname` ≤ 255, hasta 100 `connections` con formato
`[A-Za-z0-9_.-]{1,64}` (las demás se descartan).

## Mensajes de Nexo → Edge

```jsonc
{ "type": "welcome", "edgeId": "<id>", "name": "Sede principal" }
{ "type": "pong" }

// Consulta declarada (SQL de la operación del conector + parámetros nombrados)
{ "type": "query", "id": "<uuid>", "connectionKey": "astrans", "engine": "mssql",
  "sql": "SELECT placa, estado FROM dbo.vehiculos WHERE placa = :placa",
  "params": { "placa": "ABC123" }, "mode": "read", "maxRows": 500, "timeoutMs": 15000,
  "operation": "vehiculo_por_placa" }

// Esquema (filtro opcional por tablas o texto)
{ "type": "schema", "id": "<uuid>", "connectionKey": "astrans", "tables": ["dbo.vehiculos"] }

// Prueba de conexión (SELECT 1 + versión)
{ "type": "test", "id": "<uuid>", "connectionKey": "astrans" }
```

### Validación en el Edge (defensa en profundidad)

1. `connectionKey` debe existir en `edge.yaml` → si no, `BAD_REQUEST`.
2. Si llega `engine` y no coincide con el de la conexión local → `BAD_REQUEST`.
3. `mode: "write"` exige `allowWrites: true` en la conexión local → si no, `POLICY` (aunque el conector lo permita).
4. `mode: "read"`: una sola sentencia, empieza por `SELECT`/`WITH`, sin palabras de escritura (`INSERT`, `DELETE`,
   `INTO`, `EXEC`…) → si no, `POLICY`. Se ejecuta en transacción de solo lectura (PG/MySQL) o con rollback (MSSQL).
5. `allowedTables` (si está definida): toda tabla referenciada debe estar en la lista → si no, `POLICY`.
6. Límites: `maxRows` ≤ mín(solicitado, tope local, 5000); `timeoutMs` ≤ mín(solicitado, tope local, 60000).
7. Errores del motor → `DB` (el conector devuelve `ok: false` con el mensaje).

Nexo traduce `POLICY`/`BAD_REQUEST` en HTTP 400 y `DB` en `{ ok: false, data: { error } }`.

## Enrutamiento entre instancias (Redis pub/sub)

El socket de un Edge vive en **una** instancia de la API; las solicitudes pueden nacer en otra instancia o en un
worker de flujos:

1. `EdgeService.request(workspaceId, edgeId, payload, timeoutMs)` verifica que el Edge pertenezca al workspace
   (si no, 404) y que declare la `connectionKey`.
2. Se suscribe a `edge:res:<requestId>` y publica en `edge:req:<edgeId>` el sobre
   `{ requestId, edgeId, message, deadline }`.
3. Si nadie recibe la publicación (0 suscriptores) → HTTP 503 «El Edge "…" no está conectado».
4. La instancia con el socket reenvía `message` al Edge y registra el `id` como pendiente **de ese socket**: solo
   acepta respuestas con un `id` pendiente propio (un Edge no puede responder solicitudes de otro).
5. La respuesta se publica en `edge:res:<requestId>`. Sin respuesta en `timeoutMs + 5 s` → HTTP 504
   «El Edge "…" no respondió en N ms». Si el socket se cierra con solicitudes pendientes, se responden con `error`
   `CONNECTION`.
6. `edge:control` difunde `{ type: "kick", edgeId, keepConnId?, reason }` para reemplazos y revocaciones.

## Auditoría

- API (logger `EdgeAudit`): `edge.request` con `workspaceId`, `edgeId`, `type`, `connectionKey`, `operation`,
  `mode`, `rows`, `durationMs` y `status` (`ok`, `error:<code>`, `failed`). También `edge.connected`,
  `edge.hello`, `edge.disconnected`, `edge.heartbeat_timeout`.
- Edge (stdout JSON): `consulta`/`esquema` con conexión, operación, filas, duración y estado; `solicitud rechazada`
  con el código.
- Nunca se registran SQL, parámetros, filas, credenciales ni el token.

## Compatibilidad

- Campos desconocidos se ignoran en ambos sentidos; tipos de mensaje desconocidos se ignoran (se registran en debug).
- Cambios incompatibles requerirán un campo `protocol` en `hello` y negociación de versión.

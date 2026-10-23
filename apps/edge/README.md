# Nexo Edge

Agente on-premise que conecta Nexo con bases de datos (SQL Server, PostgreSQL, MySQL) que viven en la red privada
del cliente, **sin abrir puertos entrantes**: el Edge abre una conexión WebSocket segura **saliente** hacia Nexo
(`wss://<nexo>/api/edge/ws`) y ejecuta allí las consultas declaradas en los conectores `DATABASE` en modo `edge`.

- Las credenciales de las bases de datos **nunca salen de su red**: viven en `edge.yaml` (o en variables de entorno).
  Nexo solo conoce el nombre de cada conexión (`connectionKey`).
- Defensa en profundidad: el Edge re-valida localmente cada solicitud (solo lectura, una sola sentencia,
  `allowWrites`, límite de filas y de tiempo, tablas permitidas) aunque Nexo ya lo haya hecho.
- Reconexión automática con backoff exponencial (1 s → 60 s con jitter) y heartbeat cada 15 s.
- Registros JSON en stdout con auditoría mínima (conexión, operación, filas, duración, estado). Nunca registra
  credenciales, SQL ni datos.

Protocolo: [`docs/edge-protocol.md`](../../docs/edge-protocol.md) · Decisión: [ADR 0005](../../docs/adr/0005-catalogo-de-conectores-y-datos-empresariales.md).

## 1. Registrar el Edge en Nexo

En Nexo (rol ADMIN u OWNER): **Administración → Nexo Edge → Nuevo Edge**, o por API:

```bash
curl -X POST https://nexo.ejemplo.com/api/admin/edges \
  -H "Authorization: Bearer $NEXO_JWT" -H 'Content-Type: application/json' \
  -d '{"name":"Sede principal"}'
# → { "id": "...", "name": "Sede principal", "token": "nexoedge_..." }
```

El token `nexoedge_...` **se muestra una sola vez** (Nexo guarda solo su hash SHA-256). Si se pierde o se filtra,
rótelo (`POST /api/admin/edges/:id/rotate-token`): la conexión abierta con el token anterior se cierra de inmediato.

## 2. Configurar las conexiones (`edge.yaml`)

Copie [`edge.example.yaml`](edge.example.yaml) como `edge.yaml` y ajuste sus conexiones:

```yaml
connections:
  astrans:
    engine: mssql              # postgres | mysql | mssql
    host: 10.0.0.15
    port: 1433
    database: ASTRANS
    user: nexo_lectura
    password: ${ASTRANS_DB_PASSWORD}   # variable de entorno (también ${VAR:-por_defecto})
    ssl: false
    allowWrites: false         # por defecto false
    maxRows: 1000              # tope local (máx. 5000)
    timeoutMs: 30000           # tope local (máx. 60000)
    allowedTables: [dbo.vehiculos, dbo.viajes]   # opcional
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `engine` | sí | `postgres`, `mysql` o `mssql` |
| `host`, `database`, `user` | sí | Datos de conexión |
| `port` | no | Def. 5432 / 3306 / 1433 |
| `password` | no | Use `${VARIABLE}` para no escribirla en el archivo |
| `ssl` | no | `true` (TLS verificando certificado), `{ rejectUnauthorized: false }` o `{ caFile: /ruta/ca.pem }` |
| `allowWrites` | no | `true` para permitir operaciones `write` (Nexo además exige `allowWrites` en el conector) |
| `maxRows`, `timeoutMs` | no | Topes locales, se aplican sobre los que pida Nexo |
| `allowedTables` | no | Lista de `tabla` o `esquema.tabla`. Las consultas que referencien otras tablas se rechazan y el esquema solo muestra estas. La detección es léxica y **conservadora** (ante la duda, rechaza) |
| `poolMax` | no | Conexiones simultáneas por base (def. 5) |

Recomendaciones: use un usuario de base de datos **de solo lectura** con permisos mínimos (la validación del Edge
es una barrera adicional, no un sustituto), y para escrituras prefiera procedimientos almacenados.

## 3. Ejecutar con Docker (recomendado)

```bash
docker build -t nexo/edge apps/edge          # o use la imagen publicada nexo/edge

docker run -d --name nexo-edge --restart unless-stopped \
  -e NEXO_URL=https://nexo.ejemplo.com \
  -e NEXO_EDGE_TOKEN=nexoedge_xxxxxxxx \
  -e ASTRANS_DB_PASSWORD=******** \
  -v "$PWD/edge.yaml:/app/edge.yaml:ro" \
  nexo/edge
docker logs -f nexo-edge
```

Con Docker Compose:

```yaml
services:
  nexo-edge:
    image: nexo/edge
    restart: unless-stopped
    environment:
      NEXO_URL: https://nexo.ejemplo.com
      NEXO_EDGE_TOKEN: ${NEXO_EDGE_TOKEN}
      ASTRANS_DB_PASSWORD: ${ASTRANS_DB_PASSWORD}
    volumes:
      - ./edge.yaml:/app/edge.yaml:ro
```

Ejecute **una sola instancia por token**: si se conecta otra con el mismo token, reemplaza a la anterior (que
reintenta con el backoff máximo).

## 4. Ejecutar sin Docker (Node 22+)

```bash
cd apps/edge
npm ci && npm run build
NEXO_URL=https://nexo.ejemplo.com NEXO_EDGE_TOKEN=nexoedge_... EDGE_CONFIG=./edge.yaml npm start
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `NEXO_URL` | URL pública de la API de Nexo (`https://nexo.ejemplo.com`). Se deriva `wss://…/api/edge/ws` |
| `NEXO_EDGE_TOKEN` | Token `nexoedge_...` del Edge |
| `EDGE_CONFIG` | Ruta de `edge.yaml` (def. `edge.yaml`; en Docker `/app/edge.yaml`) |
| `LOG_LEVEL` | `debug`, `info` (def.), `warn`, `error` |
| `EDGE_ALLOW_INSECURE` | `true` permite `http://`/`ws://` hacia hosts distintos de localhost (solo pruebas: el token viajaría sin cifrar) |

## Red y seguridad

- Solo requiere salida HTTPS (443) hacia Nexo. No expone puertos.
- El token se envía en la cabecera `Authorization` del handshake; use siempre `https://`.
- Nexo nunca envía SQL libre: solo las consultas declaradas en las operaciones del conector, con parámetros
  nombrados (`:placa`) que el driver enlaza (sin concatenación).

## Desarrollo

```bash
npm run build      # compila a dist/
npm test           # compila y ejecuta las pruebas (node:test)
npm run check:core # verifica que src/core sea idéntico al núcleo de la API
```

`src/core/` (parámetros nombrados, validación de solo lectura, límites y drivers) es una **copia idéntica** de
`apps/api/src/modules/connectors/adapters/database/core/`. Se copia (en lugar de publicarse como paquete) para que la
API y el Edge se construyan y desplieguen de forma independiente; la CI falla si ambas copias difieren. Para cambiarlo,
edite la fuente de la API y copie: `cp ../api/src/modules/connectors/adapters/database/core/*.ts src/core/`.

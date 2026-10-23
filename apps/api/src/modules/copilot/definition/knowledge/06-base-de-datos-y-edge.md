# Base de datos y Nexo Edge

## Conector de base de datos
Motores: PostgreSQL, MySQL y SQL Server. Las operaciones son **consultas declaradas** con parámetros nombrados
(por ejemplo `:placa`); nunca SQL libre desde agentes o flujos. Los parámetros siempre se enlazan (sin concatenación).
- Modo `read`: transacción de solo lectura y solo sentencias SELECT/WITH.
- Escrituras: solo si el conector tiene `allowWrites`; se recomienda usar procedimientos almacenados y aprobación humana.
- Descubrimiento de esquema: lista tablas y vistas y genera consultas SELECT sugeridas.

## Nexo Edge
Aplicación que el cliente ejecuta dentro de su red (Docker) para que Nexo consulte bases de datos privadas sin abrir
puertos entrantes: el Edge abre una conexión saliente segura hacia Nexo. Las credenciales de la base viven solo en el
archivo `edge.yaml` del cliente; Nexo solo conoce el nombre de la conexión. El Edge vuelve a validar el modo lectura,
los límites y `allowWrites` localmente.

## Cuándo usarlo
Cuando los datos operativos (por ejemplo un TMS) están en un servidor on-premise o en una red privada. Si el sistema
tiene API, prefiera la API.

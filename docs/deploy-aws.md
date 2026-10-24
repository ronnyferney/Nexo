# Despliegue del piloto de Nexo en AWS

Infraestructura como código en `infra/` (AWS CDK, TypeScript). El stack `NexoPilot` crea todo el entorno; `NexoRegistry`
guarda las imágenes versionadas (ECR, etiquetas inmutables) y `NexoGithubOidc` el rol de despliegue. Solo se despliegan
**versiones publicadas** (ver [publicación de versiones](release.md)).

## Arquitectura

```
Internet ─▶ ALB (solo HTTPS: 80 redirige a 443, HSTS; timeout 600 s para SSE/WebSocket)
              └─▶ web (nginx + Angular, Fargate) ──Service Connect──▶ api:3000 (NestJS, Fargate, migra al arrancar)
                                                                     worker (NestJS, Fargate: flujos, rutinas, evaluaciones)
                                       api + worker ─▶ RDS PostgreSQL 16 (subred aislada, cifrado, TLS, backups 7 días,
                                                   │                  protección contra borrado y snapshot al eliminar)
                                                   └─▶ ElastiCache Redis 7 (subred aislada, noeviction para BullMQ,
                                                                          TLS en tránsito + AUTH, cifrado en reposo)
Secretos: Secrets Manager (contraseña de BD, token AUTH de Redis, JWT_SECRET, ENCRYPTION_KEY, ENCRYPTION_KEYS,
          ENCRYPTION_ACTIVE_KID, ANTHROPIC_API_KEY)
          → variables de entorno
Logs: CloudWatch (30 días) · Autoescalado por CPU: api y worker 1–3 tareas
```

**Costo estimado del piloto:** ≈ 90–130 USD/mes en `us-east-1` (ALB, RDS t4g.micro, Redis t4g.micro, 3 servicios
Fargate pequeños, IPs públicas y logs), sin contar el consumo de los modelos de IA. Sin NAT Gateway para ahorrar costo:
las tareas usan IP pública, protegidas por security groups (solo el balanceador puede llegar a la web; solo la web a la API).

## Paso 1 — Preparar la cuenta (una sola vez, con un usuario administrador)

```bash
cd infra && npm ci
npx cdk bootstrap aws://<CUENTA>/<REGION>
npx cdk deploy NexoGithubOidc        # crea el rol de despliegue por OIDC para GitHub Actions
npx cdk deploy NexoRegistry          # repositorios ECR nexo/api y nexo/web (el flujo de despliegue también lo asegura)
```

En GitHub (repositorio → Settings):
- **Secrets → Actions:** `AWS_DEPLOY_ROLE_ARN` = salida `DeployRoleArn` del paso anterior.
- **Variables:** `AWS_REGION` (p. ej. `us-east-1`), `ADMIN_EMAIL` (usuario maestro) y opcionalmente
  `PLATFORM_ADMIN_EMAILS` (por defecto, el usuario maestro).
- **Dominio y certificado (obligatorios):** `DOMAIN_NAME` (p. ej. `nexo.phari.co`) y una de estas dos opciones:
  - **Route 53:** `HOSTED_ZONE_ID` y `HOSTED_ZONE_NAME` (p. ej. `phari.co`). CDK emite el certificado ACM validado por
    DNS y crea el registro alias hacia el balanceador.
  - **DNS fuera de AWS:** `CERTIFICATE_ARN` de un certificado ACM ya emitido para el dominio, en la misma región. Tras
    desplegar, cree un CNAME del dominio hacia la salida `DnsTarget`.
- **Environments:** cree el entorno `piloto` (puede exigir aprobación de un revisor antes de desplegar).
- Si actualiza desde una versión anterior de esta guía, vuelva a desplegar `NexoGithubOidc` (agrega permisos de ECR).

### Solo HTTPS (auditoría M7)

El piloto **no se publica por HTTP en claro**: sin dominio y certificado, `cdk synth`/`cdk deploy NexoPilot` falla con
el error «El piloto no se publica por HTTP en claro…» (los stacks `NexoRegistry` y `NexoGithubOidc` no se ven afectados).
Con dominio, el balanceador escucha en 443 (política `ELBSecurityPolicy-TLS13-1-2-2021-06`), el puerto 80 responde
301 hacia HTTPS y todas las respuestas llevan `Strict-Transport-Security: max-age=31536000` (cabecera del ALB; nginx
envía la misma cuando la petición llegó por HTTPS). Además, los proveedores OAuth exigen URLs de redirección HTTPS y
Nexo Edge se conecta por WSS.

**Modo solo pruebas** (`-c allowInsecureHttp=true`, o `ALLOW_INSECURE_HTTP=true`): sin dominio, publica por HTTP en
el DNS del balanceador. Contraseñas, JWT y tokens viajan sin cifrar: úselo solo en una cuenta de pruebas, sin datos ni
usuarios reales. CDK lo anuncia con una advertencia visible en cada síntesis y el flujo de GitHub **Desplegar piloto
AWS** no lo admite (exige `DOMAIN_NAME`).

## Paso 2 — Publicar una versión y desplegarla

1. Publique la versión (si aún no existe): Actions → **Preparar versión** (ver [release.md](release.md)).
2. GitHub → Actions → **Desplegar piloto AWS** → *Run workflow* → versión (p. ej. `1.1.0`) y escriba `desplegar`.
   El flujo copia las imágenes de esa versión de GHCR a ECR (mismo digest), despliega con CDK y verifica que
   `/api/health/version` y `/version.json` respondan con la versión pedida.

Alternativa local (con credenciales de AWS en su máquina):
`cd infra && npx cdk deploy NexoPilot -c imageTag=1.1.0 -c domainName=... -c hostedZoneId=... -c hostedZoneName=...`
(o `-c certificateArn=...` en lugar de la zona). Sin `imageTag` CDK construye las imágenes desde el código local: solo
para pruebas, nunca para el piloto de clientes.

El primer despliegue tarda ~20–30 min (sobre todo RDS).

## Paso 3 — Después del primer despliegue

1. **Clave de Claude:** en Secrets Manager abra el secreto de la salida `AppSecretArn` y complete `ANTHROPIC_API_KEY`.
   Reinicie: `aws ecs update-service --cluster <ClusterName> --service <api> --force-new-deployment` (y el worker).
2. **Usuario maestro:** si definió la variable `ADMIN_EMAIL` (GitHub → Variables) o `-c adminEmail=...`, la API crea en
   el primer arranque ese usuario como OWNER del workspace "Nexo" y administrador de la plataforma. Su contraseña
   inicial la genera AWS: Secrets Manager → secreto de la salida `MasterUserSecretArn` → *Recuperar valor del secreto*.
   Entre por la URL de salida `Url` y cámbiela de inmediato en **Mi cuenta** (ícono de engranaje junto a su nombre).
   La contraseña nunca pasa por GitHub, el código ni el chat; volver a desplegar no la cambia.
   Sin `ADMIN_EMAIL`, el primer usuario que se registre en la URL es OWNER de su workspace.
3. **OAuth (opcional):** registre en cada proveedor la URL de redirección `https://<dominio>/api/oauth/callback` y
   complete las claves `OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET` (HUBSPOT, GOOGLE, MICROSOFT, SALESFORCE, LINKEDIN, SLACK) en
   el secreto de la salida `AppSecretArn`; luego fuerce un nuevo despliegue de la API y del worker. Las claves vacías
   significan "sin app de la plataforma": cada cliente puede usar su app propia desde la integración.
4. **Nexo Edge:** los clientes instalan el Edge en su red apuntando a `NEXO_URL=https://<dominio>`.

## Operación

- **Logs:** CloudWatch → grupos `NexoPilot-*` (api, worker, web) y logs de PostgreSQL.
- **Consola en un contenedor (ECS Exec):** desactivado por defecto (auditoría B8). Para un diagnóstico puntual,
  despliegue con `-c enableExecuteCommand=true` (en GitHub: casilla **ecs_exec** del flujo de despliegue), luego
  `aws ecs execute-command --cluster <ClusterName> --task <id> --container api --interactive --command sh`, y vuelva a
  desplegar sin la opción al terminar. Las tareas en ejecución solo lo adquieren al reemplazarse (el despliegue lo hace).
- **Actualizar:** desplegar la nueva versión publicada (despliegue sin caída: `minHealthyPercent` 100 y rollback automático).
- **Volver a una versión anterior:** desplegar esa versión. Las migraciones de base de datos son solo hacia adelante: si
  la versión nueva aplicó una migración, la anterior debe ser compatible con ese esquema (regla: migraciones aditivas;
  eliminar columnas en una versión posterior a la que deja de usarlas).
- **¿Qué versión corre?** `curl https://<dominio>/api/health/version` y `https://<dominio>/version.json`.
- **Redis:** la API y los workers se conectan con TLS (`REDIS_TLS=true`) y el token AUTH del secreto de la salida
  `RedisAuthSecretArn` (inyectado como `REDIS_PASSWORD`). Rotar el token exige actualizarlo también en ElastiCache
  (`aws elasticache modify-replication-group --auth-token ... --auth-token-update-strategy ROTATE`) y reiniciar api y
  worker; no lo cambie solo en Secrets Manager. En local (`docker compose`) Redis sigue sin TLS: no defina `REDIS_TLS`.
- **Eliminar el piloto:** la base de datos tiene **protección contra borrado** (B8). Para eliminar el entorno a
  propósito: `aws rds modify-db-instance --db-instance-identifier <id> --no-deletion-protection --apply-immediately`
  y luego `npx cdk destroy NexoPilot` (la base de datos deja un snapshot final).
- **No reemplace `ENCRYPTION_KEY`:** es la clave legacy (`kid` `k0`) y cifra los secretos y tokens de los clientes.
  Para rotar (B7) se usa el secreto de la salida `EncryptionKeyringSecretArn`, inyectado en api y worker como
  `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KID` y `ENCRYPTION_LEGACY_READS` (se crea vacío: solo `k0`). El procedimiento
  completo está en [`docs/rotacion-de-claves.md`](rotacion-de-claves.md); en el piloto:
  1. Genere la clave (`openssl rand -hex 32`) y guarde en el secreto `ENCRYPTION_KEYS=k2026b:<hex>` con
     `ENCRYPTION_ACTIVE_KID=k0`. Las tareas leen los secretos al arrancar: reemplácelas con
     `aws ecs update-service --cluster <ClusterName> --service <servicio> --force-new-deployment` (api y worker) y
     espere a que el despliegue termine en ambos.
  2. Cambie `ENCRYPTION_ACTIVE_KID=k2026b` y vuelva a reemplazar las tareas de api y worker.
  3. Re-cifre lo existente desde una tarea de la API (ECS Exec, ver arriba):
     `node dist/common/crypto/crypto-rotate.cli.js --dry-run` y luego sin `--dry-run`.
  4. Para retirar `k0`, cuando `--dry-run` informe 0 pendientes defina `ENCRYPTION_LEGACY_READS=false`. El stack sigue
     inyectando `ENCRYPTION_KEY`: no borre ese secreto.

  Edite el secreto solo con `aws secretsmanager put-secret-value` o la consola, conservando las tres claves del JSON
  (ECS no arranca si falta una). No modifique en el código la plantilla de los secretos `EncryptionKey` ni
  `EncryptionKeyring`: CloudFormation los regeneraría y los datos cifrados dejarían de descifrarse.

## Actualizar un piloto desplegado antes del endurecimiento (M7 y B8)

- **Dominio:** un piloto que corría por HTTP necesita ahora `DOMAIN_NAME` y certificado. El oyente del puerto 80
  conserva su id lógico y pasa de servir la web a redirigir a HTTPS sin chocar por el puerto. Las URLs cambian a
  `https://<dominio>`: actualice las redirecciones OAuth registradas en los proveedores y `NEXO_URL` de los Edge.
- **Redis:** el clúster sin TLS (`AWS::ElastiCache::CacheCluster`) se **reemplaza** por un grupo de replicación con TLS
  y AUTH (ElastiCache no admite activar AUTH en un clúster existente). El Redis nuevo arranca vacío:
  - Se pierden los trabajos encolados en ese momento (ejecuciones de flujos en curso, reintentos pendientes).
    Despliegue en una ventana sin ejecuciones activas.
  - **Las programaciones cron** de flujos y de rutinas de agentes (`JobScheduler` de BullMQ) también se pierden, pero
    la API/worker las **reconstruye al arrancar** desde PostgreSQL (P9, `ScheduleReconcilerService`): registra cada
    flujo activo con `schedule` y cada rutina habilitada, corrige patrón o zona horaria y elimina los huérfanos. Una
    sola réplica reconcilia por arranque (candado `nexo:schedules:reconcile-lock` en Redis, expira a los 5 min). Ya no
    hace falta desactivar y reactivar flujos; queda como **verificación**: en CloudWatch busque la línea
    `Programadores de flujos: N creados, …` (y la de `rutinas`) del arranque y compare N con el inventario
    `SELECT count(*) FROM "Workflow" WHERE active AND schedule IS NOT NULL;` y
    `SELECT count(*) FROM "AgentRoutine" WHERE enabled;`. Si una línea indica `con error`, el aviso previo trae el id
    del flujo o rutina con un cron inválido guardado: corríjalo desde la web. Si el Redis se vacía sin reiniciar las
    tareas, fuerce un nuevo despliegue de la API (o del worker) para reconciliar.
  - Los contadores del limitador se reinician (sin efecto práctico).
- **RDS:** activar `deletionProtection` es una actualización en caliente, sin reinicio.

## Camino a producción (después del piloto)

RDS Multi-AZ, Redis con réplica (failover automático), NAT Gateway o VPC endpoints con tareas en
subredes privadas, WAF en el ALB, mínimo 2 tareas por servicio en 2 zonas, alarmas de CloudWatch y backups probados.

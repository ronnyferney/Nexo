# Despliegue del piloto de Nexo en AWS

Infraestructura como código en `infra/` (AWS CDK, TypeScript). El stack `NexoPilot` crea todo el entorno; `NexoRegistry`
guarda las imágenes versionadas (ECR, etiquetas inmutables) y `NexoGithubOidc` el rol de despliegue. Solo se despliegan
**versiones publicadas** (ver [publicación de versiones](release.md)).

## Arquitectura

```
Internet ─▶ ALB (HTTPS si hay dominio, timeout 600 s para SSE/WebSocket)
              └─▶ web (nginx + Angular, Fargate) ──Service Connect──▶ api:3000 (NestJS, Fargate, migra al arrancar)
                                                                     worker (NestJS, Fargate: flujos, rutinas, evaluaciones)
                                       api + worker ─▶ RDS PostgreSQL 16 (subred aislada, cifrado, backups 7 días)
                                                   └─▶ ElastiCache Redis 7 (subred aislada, noeviction para BullMQ)
Secretos: Secrets Manager (contraseña de BD, JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY) → variables de entorno
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
- **Variables:** `AWS_REGION` (p. ej. `us-east-1`). Para HTTPS con dominio propio: `DOMAIN_NAME` (p. ej. `nexo.phari.co`),
  `HOSTED_ZONE_ID` y `HOSTED_ZONE_NAME` de Route 53.
- **Environments:** cree el entorno `piloto` (puede exigir aprobación de un revisor antes de desplegar).
- Si actualiza desde una versión anterior de esta guía, vuelva a desplegar `NexoGithubOidc` (agrega permisos de ECR).

> Recomendado: dominio con HTTPS. Los proveedores OAuth (Google, Microsoft, HubSpot, Salesforce) exigen URLs de
> redirección HTTPS, y Nexo Edge debe conectarse por WSS.

## Paso 2 — Publicar una versión y desplegarla

1. Publique la versión (si aún no existe): Actions → **Preparar versión** (ver [release.md](release.md)).
2. GitHub → Actions → **Desplegar piloto AWS** → *Run workflow* → versión (p. ej. `1.1.0`) y escriba `desplegar`.
   El flujo copia las imágenes de esa versión de GHCR a ECR (mismo digest), despliega con CDK y verifica que
   `/api/health/version` y `/version.json` respondan con la versión pedida.

Alternativa local (con credenciales de AWS en su máquina):
`cd infra && npx cdk deploy NexoPilot -c imageTag=1.1.0 -c domainName=... -c hostedZoneId=... -c hostedZoneName=...`
(sin `imageTag` CDK construye las imágenes desde el código local: solo para pruebas, nunca para el piloto de clientes).

El primer despliegue tarda ~20–30 min (sobre todo RDS).

## Paso 3 — Después del primer despliegue

1. **Clave de Claude:** en Secrets Manager abra el secreto de la salida `AppSecretArn` y complete `ANTHROPIC_API_KEY`.
   Reinicie: `aws ecs update-service --cluster <ClusterName> --service <api> --force-new-deployment` (y el worker).
2. **Primera cuenta:** abra la URL de salida `Url` y registre el workspace del piloto (el primer usuario es OWNER).
3. **OAuth (opcional):** registre en cada proveedor la URL de redirección `https://<dominio>/api/oauth/callback` y cargue
   `OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET` como secretos de la tarea (o use apps OAuth propias de cada cliente desde la bóveda).
4. **Nexo Edge:** los clientes instalan el Edge en su red apuntando a `NEXO_URL=https://<dominio>`.

## Operación

- **Logs:** CloudWatch → grupos `NexoPilot-*` (api, worker, web) y logs de PostgreSQL.
- **Consola en un contenedor:** `aws ecs execute-command --cluster <ClusterName> --task <id> --container api --interactive --command sh`.
- **Actualizar:** desplegar la nueva versión publicada (despliegue sin caída: `minHealthyPercent` 100 y rollback automático).
- **Volver a una versión anterior:** desplegar esa versión. Las migraciones de base de datos son solo hacia adelante: si
  la versión nueva aplicó una migración, la anterior debe ser compatible con ese esquema (regla: migraciones aditivas;
  eliminar columnas en una versión posterior a la que deja de usarlas).
- **¿Qué versión corre?** `curl https://<dominio>/api/health/version` y `https://<dominio>/version.json`.
- **Eliminar el piloto:** `npx cdk destroy NexoPilot` (la base de datos deja un snapshot final).
- **Nunca rotar `ENCRYPTION_KEY`:** cifra los secretos y tokens de los clientes; rotarla requiere un proceso de recifrado.

## Camino a producción (después del piloto)

RDS Multi-AZ y `deletionProtection`, Redis con réplica y cifrado en tránsito, NAT Gateway o VPC endpoints con tareas en
subredes privadas, WAF en el ALB, mínimo 2 tareas por servicio en 2 zonas, alarmas de CloudWatch y backups probados.

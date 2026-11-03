# Housekeeping de la base de datos de desarrollo (no destructivo)

> Guía operativa para resolver **inconsistencias del historial de migraciones Prisma** (p. ej. una migración
> «fantasma»: un registro en `_prisma_migrations` que no corresponde a ninguna carpeta del repo, o una carpeta del repo
> que la BD aún no registra) **sin perder datos**. Alcance: base de datos de **desarrollo/CI**. En **producción NO se
> ejecuta nada** sin respaldo verificado y validación previa (ver §5).

## 0. Principio rector (autorización del patrocinador)

HOUSEKEEPING autorizado con una condición dura: **ninguna operación destructiva sin validar antes el ambiente y los
respaldos**. En concreto, para esta tarea:

- **Prohibido** `prisma migrate reset`, `DROP`/`TRUNCATE` de tablas, o borrar datos reales.
- Se distinguen las 4 autorizaciones (construir / acceso / gasto / activación productiva): reparar el historial de
  migraciones en dev es «construir»; **no** implica tocar producción.
- Toda acción debe ser **reversible**, **trazable** y **verificable**.

## 1. Diagnóstico (solo lectura)

Comparar lo que el repo declara contra lo que la BD registra. No modifica nada.

```bash
cd apps/api
export DATABASE_URL="postgresql://<user>:<pass>@<host>:<port>/<db>?schema=public"

# a) Estado según Prisma (fuente de verdad del diagnóstico):
npx prisma migrate status

# b) Migraciones del repo (carpetas):
ls prisma/migrations | grep -v migration_lock

# c) Migraciones registradas en la BD (incluye no terminadas y revertidas):
psql "$DATABASE_URL" -c \
  "select migration_name, finished_at is not null as finished, rolled_back_at is not null as rolledback \
   from _prisma_migrations order by started_at;"
```

Interpretación de `migrate status`:

- **«Database schema is up to date!»** → no hay nada que hacer; el historial es consistente.
- **«following migrations have not yet been applied»** → faltan aplicar (repo por delante de la BD): se resuelve con
  `migrate deploy` (§3), **no destructivo**.
- **«following migration(s) are applied to the database but missing from the local migrations directory»** → la BD tiene
  una migración que el repo no tiene (caso «fantasma»): ver §4.
- **«following migration(s) have not been applied… but have been modified»** o drift del esquema → ver §4.

## 2. Verificación del ambiente y respaldo previo (obligatorio antes de cualquier escritura)

1. Confirmar **a qué base apunta** `DATABASE_URL` (host, puerto, nombre). Nunca asumir; imprímalo y léalo.
2. Confirmar que **es una BD de desarrollo/CI** y no producción (nombre, host, ausencia de datos de clientes).
3. **Respaldo previo recomendado** (incluso en dev), rápido y reversible:

   ```bash
   pg_dump "$DATABASE_URL" -Fc -f backup-dev-$(date +%Y%m%d-%H%M%S).dump
   # Restauración (si hiciera falta): pg_restore --clean --if-exists -d "$DATABASE_URL" <archivo>.dump
   ```

4. Solo con el respaldo hecho y el ambiente confirmado se pasa a §3/§4.

## 3. Caso: faltan migraciones por aplicar (repo por delante)

No destructivo. Aplica las pendientes sin regenerar nada:

```bash
npx prisma migrate deploy      # aplica las migraciones pendientes del repo, en orden
npx prisma migrate status      # debe quedar "up to date"
```

`migrate deploy` es el mismo comando que usa el arranque del contenedor (`docker-entrypoint.sh`, con
`RUN_MIGRATIONS=true`): solo aplica lo pendiente, no borra ni recrea.

## 4. Caso: migración «fantasma» o drift (la BD registra algo que el repo no, o viceversa)

Se resuelve **marcando estados** con `prisma migrate resolve`, que **solo escribe en la tabla `_prisma_migrations`**
(metadatos del historial); **no toca tablas de datos**. Es la vía soportada por Prisma para reconciliar el historial sin
`reset`.

- **La BD registra una migración aplicada que ya debería considerarse revertida** (p. ej. se eliminó del repo porque su
  efecto se consolidó en otra): márquela como revertida en el historial (no deshace datos, solo el registro):

  ```bash
  npx prisma migrate resolve --rolled-back <nombre_migracion>
  ```

- **La BD ya tiene el esquema de una migración pero no la registra como aplicada** (p. ej. se aplicó a mano o viene de un
  dump): márquela como aplicada para que Prisma no intente re-ejecutarla:

  ```bash
  npx prisma migrate resolve --applied <nombre_migracion>
  ```

Tras cualquiera de las dos, re-verifique:

```bash
npx prisma migrate status
```

### Alternativa cuando la BD de dev NO contiene datos reales: recrear una BD efímera

Si la base de desarrollo es desechable (sin datos de clientes), lo más limpio y **sin tocar ninguna BD con datos** es
levantar una base **efímera** y aplicarle el historial desde cero. No usa `reset` sobre la BD real:

```bash
# PostgreSQL efímero en Docker (puerto alternativo para no chocar con el de desarrollo):
docker run --rm -d --name nexo-pg-efimero -e POSTGRES_USER=nexo -e POSTGRES_PASSWORD=nexo \
  -e POSTGRES_DB=nexo -p 55432:5432 postgres:16-alpine

export DATABASE_URL="postgresql://nexo:nexo@localhost:55432/nexo?schema=public"
npx prisma migrate deploy      # aplica las 55 migraciones sobre base limpia
npx prisma migrate status      # "up to date"
# al terminar: docker rm -f nexo-pg-efimero   (desaparece con sus datos; nada persistente se tocó)
```

## 5. Producción: nada sin respaldo y validación

En producción **no se ejecuta** `migrate resolve`, `migrate deploy` manual ni ninguna reparación de historial sin:

1. Respaldo verificado (snapshot/`pg_dump`) y plan de restauración probado.
2. Validación del diagnóstico en una **copia** del ambiente (no sobre producción).
3. Autorización explícita de **activación productiva** (distinta de construir/acceso/gasto).

El arranque productivo solo corre `prisma migrate deploy` (aplicar pendientes), gobernado por `RUN_MIGRATIONS` en
`docker-entrypoint.sh`, y únicamente desde una instancia (la API; los workers arrancan con `RUN_MIGRATIONS=false`).

## 6. Estado verificado en este entorno (CI/e2e)

Registro de la verificación hecha durante este housekeeping (solo lectura sobre la BD de pruebas):

- `prisma migrate status` → **«Database schema is up to date!»** (55 migraciones).
- El listado de carpetas del repo coincide **exactamente** con los registros de `_prisma_migrations` (todos
  `finished`, ninguno `rolled_back`). **No se detectó migración fantasma** en este entorno.
- Conclusión: la BD de pruebas está al día vía `migrate deploy`; **no se ejecutó ninguna operación destructiva ni de
  reparación** (no hubo nada que reparar).

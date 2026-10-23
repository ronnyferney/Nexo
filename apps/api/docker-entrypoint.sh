#!/bin/sh
# Arranque del contenedor de la API / worker.
# En AWS las credenciales de la base de datos llegan por separado (Secrets Manager): se arma DATABASE_URL aquí.
set -e
if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_NAME:-nexo}?schema=public&sslmode=${DB_SSLMODE:-require}"
  # Certificado raíz de RDS para verificar el TLS de la base de datos (no se desactiva la verificación).
  if [ -n "$DB_SSLCERT" ] && [ -f "$DB_SSLCERT" ]; then
    export DATABASE_URL="${DATABASE_URL}&sslcert=${DB_SSLCERT}"
  fi
fi
# Solo una instancia debe migrar (la API); los workers arrancan con RUN_MIGRATIONS=false.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  npx prisma migrate deploy
fi
exec node dist/main.js

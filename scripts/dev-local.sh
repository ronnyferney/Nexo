#!/usr/bin/env bash
# Nexo en local (macOS o Linux) con un solo comando.
#
#   npm run local          # prepara todo y arranca API (:3000) y web (:4200)
#   npm run local:stop     # detiene API, web, PostgreSQL y Redis
#   npm run local:status   # estado de los servicios
#   npm run local:logs     # sigue los logs de API y web
#
# Requisitos: Node.js 22+ y Docker Desktop. Con Docker, PostgreSQL y Redis de Nexo usan puertos propios (55432 y 6390)
# para no chocar con un PostgreSQL o Redis que ya tenga instalado. Sin Docker se usan PostgreSQL 16 y Redis 7 locales
# en 5432/6379 (usuario/contraseña/base `nexo`).
# Opcional al primer arranque: ADMIN_EMAIL=correo@empresa.com npm run local (usuario maestro; por defecto, el correo
# de `git config user.email`). La contraseña inicial se genera y se guarda en .dev/credenciales.txt (solo su usuario).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/.dev"
API_ENV="$ROOT/apps/api/.env"
WEB_URL="http://localhost:4200"
API_URL="http://localhost:3000/api"
PG_PORT="${NEXO_PG_PORT:-55432}"
REDIS_PORT="${NEXO_REDIS_PORT:-6390}"
mkdir -p "$DEV"

info() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- 3<&-; }

wait_for() { # wait_for <descripción> <segundos> <comando...>
  local what="$1" secs="$2"; shift 2
  for _ in $(seq 1 "$secs"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "$what no respondió a tiempo (revise $DEV/*.log)"
}

stop_pid() {
  local file="$DEV/$1.pid"
  [[ -f "$file" ]] || return 0
  local pid; pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    # Detiene el grupo de procesos (npm → nest/ng) que se creó al arrancar.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  fi
  rm -f "$file"
}

check_prereqs() {
  command -v node >/dev/null || fail "Falta Node.js 22+ (macOS: brew install node@22)"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 22 )) || fail "Se requiere Node.js 22+ (tiene $(node -v)). macOS: brew install node@22"
  command -v openssl >/dev/null || fail "Falta openssl"
  ok "Node $(node -v)"
}

# docker compose valida todo docker-compose.yml aunque solo se levanten postgres y redis: la API y el worker exigen
# JWT_SECRET y ENCRYPTION_KEY, que aquí no se usan (la API corre fuera de Docker con apps/api/.env).
compose() {
  (cd "$ROOT" && JWT_SECRET="${JWT_SECRET:-no-se-usa-en-local}" ENCRYPTION_KEY="${ENCRYPTION_KEY:-no-se-usa-en-local}" \
    NEXO_PG_PORT="$PG_PORT" NEXO_REDIS_PORT="$REDIS_PORT" docker compose "$@")
}

start_infra() {
  if ! command -v docker >/dev/null; then
    # Sin Docker: PostgreSQL y Redis locales en sus puertos estándar.
    PG_PORT=5432 REDIS_PORT=6379
    port_open 5432 && port_open 6379 ||
      fail "Falta Docker Desktop (brew install --cask docker) o PostgreSQL 16 + Redis 7 locales en 5432/6379"
    warn "Sin Docker: se usan PostgreSQL (5432) y Redis (6379) locales; requieren usuario, contraseña y base 'nexo'"
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    if [[ "$(uname)" == "Darwin" ]]; then
      info "Abriendo Docker Desktop (la primera vez acepte los términos y espere a que diga «Engine running»)…"
      open -a Docker || true
    fi
    wait_for "Docker" 300 docker info
  fi
  info "Levantando PostgreSQL ($PG_PORT) y Redis ($REDIS_PORT) de Nexo con Docker…"
  compose up -d postgres redis || fail "Docker no pudo levantar PostgreSQL y Redis (vea el mensaje anterior)"
  wait_for "PostgreSQL" 90 compose exec -T postgres pg_isready -U nexo
  wait_for "Redis" 30 port_open "$REDIS_PORT"
  ok "PostgreSQL y Redis listos"
}

# Apunta la API a la base y al Redis que se acaban de levantar (solo esas dos claves de apps/api/.env).
sync_env_ports() {
  PG="$PG_PORT" RD="$REDIS_PORT" FILE="$API_ENV" node -e '
    const fs = require("fs");
    let s = fs.readFileSync(process.env.FILE, "utf8");
    const url = `postgresql://nexo:nexo@localhost:${process.env.PG}/nexo?schema=public`;
    s = s.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`).replace(/^REDIS_PORT=.*$/m, `REDIS_PORT=${process.env.RD}`);
    // Proveedor IA simulado (solo desarrollo): se agrega si falta; si el usuario lo definió, se respeta su valor.
    if (!/^LLM_DEV_SIMULATOR=/m.test(s)) s = s.replace(/\n*$/, "\n\n# Proveedor IA simulado (solo desarrollo)\nLLM_DEV_SIMULATOR=true\n");
    // Entorno de desarrollo explícito (el simulador y las validaciones de desarrollo lo exigen).
    if (!/^NODE_ENV=/m.test(s)) s = s.replace(/\n*$/, "\nNODE_ENV=development\n");
    fs.writeFileSync(process.env.FILE, s);
  '
}

ensure_env() {
  if [[ -f "$API_ENV" ]]; then
    ok "Configuración existente: apps/api/.env (solo se ajustan los puertos de base de datos y Redis)"
    return
  fi
  info "Creando apps/api/.env con secretos generados…"
  local admin="${ADMIN_EMAIL:-$(git -C "$ROOT" config user.email 2>/dev/null || true)}"
  local password=""
  [[ -n "$admin" ]] && password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  JWT="$(openssl rand -hex 32)" ENC="$(openssl rand -hex 32)" ADMIN="$admin" PASS="$password" \
    SRC="$ROOT/apps/api/.env.example" DST="$API_ENV" node -e '
      const fs = require("fs");
      const set = (s, k, v) => s.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
      let s = fs.readFileSync(process.env.SRC, "utf8");
      s = set(s, "JWT_SECRET", process.env.JWT);
      s = set(s, "ENCRYPTION_KEY", process.env.ENC);
      // Desarrollo local: permite conectores hacia servicios de la red local (p. ej. un TMS de pruebas).
      s = set(s, "CONNECTOR_ALLOW_PRIVATE_NETWORKS", "true");
      s = set(s, "LLM_DEV_SIMULATOR", "true");
      if (process.env.ADMIN) {
        s = set(s, "BOOTSTRAP_ADMIN_EMAIL", process.env.ADMIN);
        s = set(s, "BOOTSTRAP_ADMIN_PASSWORD", process.env.PASS);
        s = set(s, "PLATFORM_ADMIN_EMAILS", process.env.ADMIN);
      }
      fs.writeFileSync(process.env.DST, s, { mode: 0o600 });
    '
  if [[ -n "$admin" ]]; then
    umask 077
    printf 'Nexo local\nURL: %s\nUsuario maestro: %s\nContraseña inicial: %s\n(Cámbiela en Mi cuenta)\n' \
      "$WEB_URL" "$admin" "$password" > "$DEV/credenciales.txt"
    ok "Usuario maestro: $admin (contraseña en .dev/credenciales.txt)"
  else
    warn "Sin ADMIN_EMAIL ni git user.email: regístrese en la web; el primer usuario es dueño de su workspace"
  fi
  warn "Para IA real agregue ANTHROPIC_API_KEY en apps/api/.env (sin ella se usa el modelo simulado)"
}

install_deps() {
  for app in api web; do
    local dir="$ROOT/apps/$app"
    if [[ ! -d "$dir/node_modules" || "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; then
      info "Instalando dependencias de ${app}…"
      (cd "$dir" && npm ci --no-audit --no-fund)
    fi
  done
  ok "Dependencias instaladas"
}

migrate() {
  info "Aplicando migraciones de base de datos…"
  (cd "$ROOT/apps/api" && npx prisma generate >/dev/null && npx prisma migrate deploy) ||
    fail "No se pudo migrar la base de datos en localhost:$PG_PORT (revise que PostgreSQL de Nexo esté arriba: npm run local:status)"
  ok "Base de datos al día"
}

start_app() { # start_app <nombre> <directorio> <comando npm>
  local name="$1" dir="$2" script="$3"
  stop_pid "$name"
  # set -m: proceso en su propio grupo para poder detener npm y sus hijos juntos. Toda la salida va al log para que
  # el proceso no quede atado a la terminal que ejecutó el script.
  set -m
  (cd "$dir" && exec nohup npm run "$script") >"$DEV/$name.log" 2>&1 </dev/null &
  echo $! >"$DEV/$name.pid"
  set +m
}

# Si el usuario maestro ya existía en la base de datos, la contraseña generada no aplica (la API nunca la cambia).
check_credentials() {
  local file="$DEV/credenciales.txt"
  [[ -f "$file" ]] || return 0
  local email pass
  email="$(sed -n 's/^Usuario maestro: //p' "$file")"
  pass="$(sed -n 's/^Contraseña inicial: //p' "$file")"
  [[ -n "$email" && -n "$pass" ]] || return 0
  local body
  body="$(EMAIL="$email" PASS="$pass" node -e 'process.stdout.write(JSON.stringify({ email: process.env.EMAIL, password: process.env.PASS }))')"
  if ! curl -sf -o /dev/null -H 'content-type: application/json' -d "$body" "$API_URL/auth/login"; then
    printf 'Nexo local\nURL: %s\nUsuario maestro: %s\nEste usuario ya existía en la base de datos: use su contraseña actual.\n' \
      "$WEB_URL" "$email" > "$file"
    warn "El usuario maestro $email ya existía: use su contraseña actual"
  fi
}

up() {
  check_prereqs
  start_infra
  ensure_env
  sync_env_ports
  install_deps
  migrate
  info "Arrancando API y web…"
  start_app api "$ROOT/apps/api" start:dev
  start_app web "$ROOT/apps/web" start
  wait_for "La API" 180 curl -sf "$API_URL/health"
  ok "API lista en $API_URL (Swagger: http://localhost:3000/api/docs)"
  wait_for "La web" 240 curl -sf "$WEB_URL"
  ok "Web lista en $WEB_URL"
  check_credentials
  [[ -f "$DEV/credenciales.txt" ]] && { echo; cat "$DEV/credenciales.txt"; echo; }
  if [[ "$(uname)" == "Darwin" ]]; then open "$WEB_URL"; fi
  echo "Logs: npm run local:logs · Detener: npm run local:stop"
}

stop() {
  stop_pid web
  stop_pid api
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    compose stop postgres redis >/dev/null 2>&1 || true
  fi
  ok "Nexo local detenido (los datos se conservan)"
}

status() {
  curl -sf "$API_URL/health/version" >/dev/null && ok "API: $(curl -s "$API_URL/health/version")" || warn "API detenida"
  curl -sf "$WEB_URL" >/dev/null && ok "Web: $WEB_URL" || warn "Web detenida"
  local pg rd
  pg="$(sed -n 's#^DATABASE_URL=.*@localhost:\([0-9]*\)/.*#\1#p' "$API_ENV" 2>/dev/null)"
  rd="$(sed -n 's/^REDIS_PORT=//p' "$API_ENV" 2>/dev/null)"
  port_open "${pg:-$PG_PORT}" && ok "PostgreSQL: ${pg:-$PG_PORT}" || warn "PostgreSQL detenido"
  port_open "${rd:-$REDIS_PORT}" && ok "Redis: ${rd:-$REDIS_PORT}" || warn "Redis detenido"
}

case "${1:-up}" in
  up) up ;;
  stop) stop ;;
  status) status ;;
  logs) tail -n 50 -f "$DEV/api.log" "$DEV/web.log" ;;
  *) fail "Uso: scripts/dev-local.sh [up|stop|status|logs]" ;;
esac

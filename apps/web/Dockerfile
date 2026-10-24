# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=
ARG BUILD_DATE=
LABEL org.opencontainers.image.title="nexo-web" \
      org.opencontainers.image.source="https://github.com/ronnyferney/Nexo" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/nexo-security-headers.conf
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
# Versión publicada de la web (la consultan el despliegue y el soporte).
RUN printf '{"version":"%s","commit":"%s","builtAt":"%s"}\n' "$APP_VERSION" "$GIT_SHA" "$BUILD_DATE" > /usr/share/nginx/html/version.json
EXPOSE 80

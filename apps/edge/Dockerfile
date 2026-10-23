# Nexo Edge — imagen nexo/edge
#   docker build -t nexo/edge apps/edge
#   docker run -d --name nexo-edge --restart unless-stopped \
#     -e NEXO_URL=https://nexo.ejemplo.com -e NEXO_EDGE_TOKEN=nexoedge_... \
#     -v "$PWD/edge.yaml:/app/edge.yaml:ro" nexo/edge

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && rm -f dist/*.test.* && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=
ARG BUILD_DATE=
LABEL org.opencontainers.image.title="nexo-edge" \
      org.opencontainers.image.source="https://github.com/ronnyferney/Nexo" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"
WORKDIR /app
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    EDGE_CONFIG=/app/edge.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json edge.example.yaml ./
# Sin puertos expuestos: el Edge solo abre una conexión saliente (WSS) hacia Nexo.
USER node
CMD ["node", "dist/main.js"]

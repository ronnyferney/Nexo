#!/usr/bin/env node
import { EdgeClient } from './client';
import { ConfigError, loadEdgeConfig } from './config';
import { createLogger, type LogLevel } from './logger';

/** Punto de entrada: `NEXO_URL`, `NEXO_EDGE_TOKEN` y `edge.yaml` (ruta en `EDGE_CONFIG`). */
function main() {
  const logger = createLogger((process.env.LOG_LEVEL as LogLevel) || 'info');
  const url = process.env.NEXO_URL;
  const token = process.env.NEXO_EDGE_TOKEN;
  const configPath = process.env.EDGE_CONFIG || 'edge.yaml';
  if (!url || !token) {
    logger.error('Defina NEXO_URL y NEXO_EDGE_TOKEN');
    process.exit(2);
  }
  let client: EdgeClient;
  try {
    const config = loadEdgeConfig(configPath);
    client = new EdgeClient({
      url,
      token,
      config,
      logger,
      allowInsecure: process.env.EDGE_ALLOW_INSECURE === 'true',
    });
    logger.info('Nexo Edge iniciado', { config: configPath, connections: Object.keys(config.connections) });
  } catch (err) {
    logger.error(err instanceof ConfigError ? err.message : `No se pudo iniciar: ${(err as Error).message}`);
    process.exit(2);
  }
  client.start();
  const shutdown = (signal: string) => {
    logger.info('deteniendo', { signal });
    void client.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

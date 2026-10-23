import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BuildInfo {
  version: string;
  commit: string | null;
  builtAt: string | null;
}

/** Versión publicada (la inyecta la imagen de la versión vía APP_VERSION; en desarrollo, la del package.json). */
export function readBuildInfo(
  env: NodeJS.ProcessEnv = process.env,
  packageJsonPath = join(__dirname, '..', '..', 'package.json'),
): BuildInfo {
  let version = env.APP_VERSION?.trim();
  if (!version) {
    try {
      version = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string }).version;
    } catch {
      version = undefined;
    }
  }
  return {
    version: version || '0.0.0-dev',
    commit: env.GIT_SHA?.trim() || null,
    builtAt: env.BUILD_DATE?.trim() || null,
  };
}

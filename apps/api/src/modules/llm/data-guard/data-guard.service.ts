import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PrivacySettingsService } from '../../data-protection/privacy-settings.service';
import { SecretsService } from '../../workspaces/secrets.service';
import type { LlmClient } from '../llm-provider';
import { guardClient } from './guarded-client';
import { MaskSession, type DataGuardMode } from './mask-session';

/**
 * DataGuard (ADR 0008 D1-D2): punto único de protección de datos en la salida hacia cualquier proveedor LLM. El
 * gateway envuelve con `wrap` todo cliente que resuelve, así que agentes, flujos, rutinas, evaluaciones, servidor MCP
 * y Copilot pasan por aquí sin condicionales repartidos por el código.
 */
@Injectable()
export class DataGuardService {
  private readonly baseKey: Buffer;

  constructor(
    private readonly settings: PrivacySettingsService,
    private readonly secrets: SecretsService,
    config: ConfigService,
  ) {
    // Clave de los marcadores: secreta (no se puede adivinar un valor por fuerza bruta desde su marcador) y estable
    // entre reinicios y réplicas (los marcadores del historial deben repetirse para la caché de prompts).
    const material = [config.get<string>('encryptionKey') ?? '', config.get<string>('jwt.secret') ?? ''].join('|');
    this.baseKey = createHash('sha256').update(`nexo:dataguard:v1|${material}`).digest();
  }

  /** Sesión de enmascarado de una ejecución: política del workspace, valores de la bóveda y clave del ámbito. */
  async session(workspaceId: string, scope?: string, mode?: DataGuardMode): Promise<MaskSession> {
    const [settings, vault] = await Promise.all([
      mode ? Promise.resolve(null) : this.settings.get(workspaceId),
      this.secrets.resolveAll(workspaceId),
    ]);
    const key = createHmac('sha256', this.baseKey)
      .update(`${workspaceId}|${scope ?? `run:${randomUUID()}`}`)
      .digest();
    return new MaskSession(key, mode ?? settings!.dataGuardMode, Object.values(vault));
  }

  /** Cliente con DataGuard aplicado en cada ejecución (la política se lee en cada `run`). */
  wrap(workspaceId: string, client: LlmClient): LlmClient {
    return guardClient(client, (scope) => this.session(workspaceId, scope));
  }

  /** Prueba de la política (`POST /admin/data-protection/test`): hallazgos sin valores y la vista para el modelo. */
  async preview(workspaceId: string, text: string) {
    const s = await this.session(workspaceId, `preview:${randomUUID()}`);
    const findings = s.findings(text).map(({ category, kind, start, end, confidence }) => ({
      category,
      kind,
      start,
      end,
      confidence,
    }));
    const blocked = s.mode === 'block' && s.personal(text).length > 0;
    return { mode: s.mode, findings, blocked, masked: s.maskText(text) };
  }
}

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { ROLE_RANK } from '../../../common/decorators/roles.decorator';
import { render } from '../../../common/template/template.engine';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OAuthService } from '../../oauth/oauth.service';
import { SkillsService, slugify } from '../../skills/skills.service';
import { SecretsService } from '../../workspaces/secrets.service';
import { ConnectorsService } from '../connectors.service';
import type { ConnectorAuth } from '../domain/connector.types';
import { CATALOG, findCatalogEntry } from './catalog.index';
import type { InstallCatalogDto } from './catalog.dto';
import { secretName, type CatalogAuthMethod, type CatalogEntry } from './catalog.types';
import { COMMERCIAL_SKILLS } from './commercial-skills';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const MAX_CREDENTIAL_LENGTH = 8192;

/** Extrae las referencias `{{ secrets.X }}` de una plantilla. */
const secretRefKey = (template: unknown): string | undefined =>
  typeof template === 'string' ? /\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/.exec(template)?.[1] : undefined;

/** Catálogo de conectores nativos (ADR 0005, D2): listado, instalación con un clic y kit comercial. */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly connectors: ConnectorsService,
    private readonly oauth: OAuthService,
    private readonly skills: SkillsService,
  ) {}

  async list(workspaceId: string) {
    const counts = await this.prisma.connector.groupBy({
      by: ['catalogId'],
      where: { workspaceId, catalogId: { not: null } },
      _count: { _all: true },
    });
    const installed = new Map(counts.map((c) => [c.catalogId, c._count._all]));
    return CATALOG.map((e) => this.view(e, installed.get(e.id) ?? 0));
  }

  async install(a: AuthContext, id: string, dto: InstallCatalogDto) {
    const entry = findCatalogEntry(id);
    if (!entry) throw new NotFoundException('Integración no encontrada en el catálogo');
    const methods = Object.keys(entry.auth) as CatalogAuthMethod[];
    const method = dto.authMethod ?? methods[0];
    const authTemplate = entry.auth[method];
    if (!authTemplate) {
      throw new BadRequestException(
        `${entry.name} no admite el método de autenticación "${method}". Use: ${methods.join(', ')}`,
      );
    }

    const values = this.credentialValues(entry, method, dto.credentials ?? {});
    const auth = this.authFor(authTemplate, values, entry);
    const secretValues = Object.fromEntries(Object.entries(values).map(([k, v]) => [secretName(entry.slug, k), v]));

    // OAuth: se valida que exista una app (propia o de la plataforma) antes de guardar nada.
    if (auth.type === 'oauth2_code') this.oauth.resolveApp(render(auth, { secrets: secretValues }));

    await this.assertCanWriteSecrets(a, entry, secretValues);
    for (const [name, value] of Object.entries(secretValues)) await this.secrets.upsert(a.workspaceId, name, value);

    const created = await this.prisma.connector.create({
      data: {
        workspaceId: a.workspaceId,
        name: dto.name?.trim() || entry.name,
        description: entry.description,
        type: entry.connectorType,
        catalogId: entry.id,
        config: json(entry.config),
        auth: json(auth),
        operations: {
          create: entry.operations.map((op) => ({
            key: op.key,
            name: op.name,
            description: op.description,
            inputSchema: json(op.inputSchema),
            definition: json(op.definition),
          })),
        },
      },
    });

    let discoveryError: string | undefined;
    if (entry.discoverOnInstall) {
      try {
        await this.connectors.discover(a.workspaceId, created.id);
      } catch (err) {
        discoveryError = `No se pudieron importar las tools: ${(err as Error).message}. Reintente con "Descubrir".`;
        this.logger.warn(`Descubrimiento al instalar ${entry.id} (${created.id}) fallido`);
      }
    }

    const connector = await this.connectors.get(a.workspaceId, created.id);
    const result: Record<string, unknown> = { ...connector, secrets: Object.keys(secretValues) };
    if (discoveryError) result.discoveryError = discoveryError;
    if (auth.type === 'oauth2_code' && a.userId) {
      result.authorizeUrl = (await this.oauth.start(a.workspaceId, created.id, a.userId)).authorizeUrl;
    }
    return result;
  }

  /** Crea (si no existen por slug) las skills comerciales del kit y devuelve sus ids. */
  async installCommercialKit(workspaceId: string) {
    const skills: { id: string; name: string; slug: string; created: boolean }[] = [];
    for (const s of COMMERCIAL_SKILLS) {
      const slug = slugify(s.name);
      const existing = await this.prisma.skill.findFirst({ where: { workspaceId, slug }, select: { id: true } });
      if (existing) {
        skills.push({ id: existing.id, name: s.name, slug, created: false });
        continue;
      }
      const skill = await this.skills.create(workspaceId, {
        name: s.name,
        description: s.description,
        instructions: s.instructions,
      });
      skills.push({ id: skill.id, name: skill.name, slug: skill.slug, created: true });
    }
    return { created: skills.filter((s) => s.created).length, skills };
  }

  // ---------- Internos ----------
  /**
   * `PUT /workspace/secrets` es ADMIN: instalar (EDITOR) no puede usarse para reemplazar credenciales ya guardadas.
   * Si algún `<SLUG>_*` existe con otro valor y el usuario no es ADMIN/OWNER → 409 sin escribir nada. Reutilizar el
   * mismo valor (p. ej. otra instancia del conector con la misma cuenta) no es conflicto.
   */
  private async assertCanWriteSecrets(a: AuthContext, entry: CatalogEntry, secretValues: Record<string, string>) {
    if (ROLE_RANK[a.role] >= ROLE_RANK.ADMIN) return;
    const current = await this.secrets.resolveMany(a.workspaceId, Object.keys(secretValues));
    const changed = Object.keys(current).some((name) => current[name] !== secretValues[name]);
    if (changed) {
      throw new ConflictException(
        `Ya existen credenciales de ${entry.name} en la bóveda; solo un administrador puede reemplazarlas`,
      );
    }
  }

  private credentialValues(
    entry: CatalogEntry,
    method: CatalogAuthMethod,
    credentials: Record<string, unknown>,
  ): Record<string, string> {
    const known = new Set(entry.credentialFields.map((f) => f.key));
    const unknown = Object.keys(credentials).filter((k) => !known.has(k));
    if (unknown.length) throw new BadRequestException(`Campos de credencial desconocidos: ${unknown.join(', ')}`);

    const values: Record<string, string> = {};
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const f of entry.credentialFields) {
      if (f.authMethods && !f.authMethods.includes(method)) continue;
      const raw = credentials[f.key];
      if (raw !== undefined && typeof raw !== 'string') {
        invalid.push(f.label);
        continue;
      }
      const value = (raw ?? '').trim() || f.default || '';
      if (!value) {
        if (f.required) missing.push(f.label);
        continue;
      }
      if (value.length > MAX_CREDENTIAL_LENGTH || (f.pattern && !new RegExp(f.pattern).test(value))) {
        invalid.push(f.label);
        continue;
      }
      values[f.key] = value;
    }
    if (missing.length) throw new BadRequestException(`Faltan credenciales requeridas: ${missing.join(', ')}`);
    if (invalid.length) throw new BadRequestException(`Credenciales con formato inválido: ${invalid.join(', ')}`);
    return values;
  }

  /** Autenticación del conector: en OAuth se quitan las referencias a la app propia si no se ingresó. */
  private authFor(template: ConnectorAuth, values: Record<string, string>, entry: CatalogEntry): ConnectorAuth {
    const auth = structuredClone(template);
    if (auth.type !== 'oauth2_code') return auth;
    const provided = (ref?: string) => {
      const name = secretRefKey(ref);
      return !!name && Object.keys(values).some((k) => secretName(entry.slug, k) === name);
    };
    const hasId = provided(auth.clientIdRef);
    const hasSecret = provided(auth.clientSecretRef);
    if (hasId !== hasSecret) {
      throw new BadRequestException('Para usar una app OAuth propia ingrese el client ID y el client secret');
    }
    if (!hasId) {
      delete auth.clientIdRef;
      delete auth.clientSecretRef;
    }
    return auth;
  }

  private view(e: CatalogEntry, installed: number) {
    return {
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description,
      icon: e.icon,
      docsUrl: e.docsUrl,
      connectorType: e.connectorType,
      authMethods: Object.keys(e.auth) as CatalogAuthMethod[],
      credentialFields: e.credentialFields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: f.secret,
        required: f.required,
        ...(f.help ? { help: f.help } : {}),
        ...(f.authMethods ? { authMethods: f.authMethods } : {}),
        ...(f.default ? { default: f.default } : {}),
      })),
      operations: e.operations.map((o) => ({ key: o.key, name: o.name, description: o.description, write: o.write })),
      verified: e.verified,
      ...(e.verificationNotes ? { verificationNotes: e.verificationNotes } : {}),
      installed,
    };
  }
}

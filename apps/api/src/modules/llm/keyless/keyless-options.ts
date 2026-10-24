/**
 * Conexiones Claude **sin claves** (ADR 0002 D9, plan de mejora L2 y L3). Se guardan en `LlmConnection.driverOptions`
 * (`keyless`, solo identificadores no secretos) con `apiKeyCipher = null`: la credencial se obtiene en cada uso.
 *
 * - `WORKLOAD_IDENTITY`: Nexo firma un JWT corto como emisor OIDC y lo canjea en `POST /v1/oauth/token` de Anthropic
 *   (RFC 7523, `jwt-bearer`) por un token de acceso de una cuenta de servicio del cliente.
 * - `AWS_ROLE`: Nexo asume el rol de IAM del cliente con STS `AssumeRole` + `ExternalId` y firma con SigV4.
 */
export type KeylessMechanism = 'WORKLOAD_IDENTITY' | 'AWS_ROLE';

export interface WorkloadIdentityOptions {
  type: 'WORKLOAD_IDENTITY';
  /** Regla de federación de la Consola de Claude (`fdrl_…`). */
  federationRuleId: string;
  /** UUID de la organización de Anthropic. */
  organizationId: string;
  /** Cuenta de servicio destino (`svac_…`). */
  serviceAccountId: string;
  /** Workspace de Anthropic (`wrkspc_…`), obligatorio si la regla cubre más de uno. */
  workspaceId?: string;
}

export interface AwsRoleOptions {
  type: 'AWS_ROLE';
  /** Rol de IAM del cliente que Nexo asume. */
  roleArn: string;
  /** ExternalId único de la conexión, generado por Nexo y fijado en la política de confianza del cliente. */
  externalId: string;
  region: string;
}

export type KeylessOptions = WorkloadIdentityOptions | AwsRoleOptions;

// Formatos documentados en platform.claude.com/docs/en/manage-claude/wif-reference («Token exchange request»).
export const FEDERATION_RULE_PATTERN = '^fdrl_[A-Za-z0-9]{1,128}$';
export const SERVICE_ACCOUNT_PATTERN = '^svac_[A-Za-z0-9]{1,128}$';
export const ORGANIZATION_ID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const ANTHROPIC_WORKSPACE_PATTERN = '^wrkspc_[A-Za-z0-9]{4,64}$';
/** ARN de un rol de IAM (particiones aws, aws-cn, aws-us-gov…; ruta y nombre con los caracteres que admite IAM). */
export const ROLE_ARN_PATTERN = '^arn:aws(-[a-z]+)*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$';
export const AWS_REGION_PATTERN = '^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$';
/**
 * ExternalId generado por Nexo: `nexo-` + 32 caracteres base64url (192 bits). Cumple la expresión de STS
 * (alfanuméricos y `_+=,.@:/-`, según el modelo oficial de `@aws-sdk/client-sts`).
 */
export const EXTERNAL_ID_PATTERN = '^nexo-[A-Za-z0-9_-]{32}$';

const str = (v: unknown, pattern: string) => (typeof v === 'string' && new RegExp(pattern).test(v) ? v : undefined);

/** `driverOptions.keyless` validado al leer (un valor inválido o manipulado se ignora). */
export function parseKeyless(raw: unknown): KeylessOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.type === 'WORKLOAD_IDENTITY') {
    const federationRuleId = str(o.federationRuleId, FEDERATION_RULE_PATTERN);
    const organizationId = str(o.organizationId, ORGANIZATION_ID_PATTERN);
    const serviceAccountId = str(o.serviceAccountId, SERVICE_ACCOUNT_PATTERN);
    if (!federationRuleId || !organizationId || !serviceAccountId) return null;
    const workspaceId = str(o.workspaceId, ANTHROPIC_WORKSPACE_PATTERN);
    return {
      type: 'WORKLOAD_IDENTITY',
      federationRuleId,
      organizationId,
      serviceAccountId,
      ...(workspaceId ? { workspaceId } : {}),
    };
  }
  if (o.type === 'AWS_ROLE') {
    const roleArn = str(o.roleArn, ROLE_ARN_PATTERN);
    const externalId = str(o.externalId, EXTERNAL_ID_PATTERN);
    const region = str(o.region, AWS_REGION_PATTERN);
    if (!roleArn || !externalId || !region) return null;
    return { type: 'AWS_ROLE', roleArn, externalId, region };
  }
  return null;
}

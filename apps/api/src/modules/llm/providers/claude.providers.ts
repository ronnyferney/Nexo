import { ANTHROPIC_WORKSPACE_PATTERN, AWS_REGION_PATTERN, ROLE_ARN_PATTERN } from '../keyless/keyless-options';
import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import { ENTRA_AI_OAUTH, GOOGLE_CLOUD_OAUTH } from './enterprise.providers';
import { ANTHROPIC_SPECIALTIES, CLAUDE_COVERED_MODELS_NOTICE } from './frontier.providers';
import {
  API_KEY_FIELD,
  type ProviderCatalogEntry,
  type ProviderField,
  type SuggestedModel,
} from './provider-catalog.types';

/**
 * Claude es una familia de modelos a la que se llega por varios canales oficiales: los modelos son los mismos y cambian
 * quién opera el servicio, la autenticación y la facturación. Fuentes: skill oficial `claude-api` de Anthropic
 * (2026-10-06): «Claude Models on Google Cloud (Anthropic managed)» (SDK `@anthropic-ai/google-cloud-sdk`, token de
 * Google, rol `roles/claude.user`, workspace `wrkspc_`, ubicación `global`, sin claves de API), «Google Cloud Vertex AI»
 * (`@anthropic-ai/vertex-sdk`, proyecto y región, ids sin prefijo, tarifas de Google) y «Microsoft Foundry»
 * (`@anthropic-ai/foundry-sdk`, recurso `https://<recurso>.services.ai.azure.com/anthropic`, clave o token de Entra ID,
 * tarifas de la API de Anthropic vía Microsoft Marketplace). Ninguno usa suscripciones personales (Pro/Max).
 * Entra ID en Foundry (verificado el 2026-10-24 en platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-
 * foundry, «Microsoft Entra authentication», y en el README de `@anthropic-ai/foundry-sdk` 1.1.0): token con el scope
 * `https://ai.azure.com/.default` en `Authorization: Bearer`; rol de Azure RBAC «Foundry User» (antes «Azure AI User») o
 * «Cognitive Services User»; tokens de ~1 hora. Datos: «For deployments hosted on Azure, prompts and completions remain
 * within Azure» (misma página, «Hosting options»).
 */

/**
 * Modelos Claude actuales; `priced: false` cuando el canal factura con tarifas propias (Google, AWS). `idPrefix`: los
 * ids de Claude en Amazon Bedrock llevan `anthropic.` (platform.claude.com, «Supported models»).
 */
function claudeModels(priced: boolean, idPrefix = ''): SuggestedModel[] {
  return SYSTEM_ANTHROPIC_MODELS.map((m) => ({
    id: `${idPrefix}${m.id}`,
    label: m.label,
    tier: m.tier,
    ...(priced
      ? {
          inputUsdPerMTok: m.inputUsdPerMTok,
          outputUsdPerMTok: m.outputUsdPerMTok,
          ...(m.cacheReadUsdPerMTok !== null ? { cacheReadUsdPerMTok: m.cacheReadUsdPerMTok } : {}),
        }
      : {}),
    contextTokens: 1_000_000,
    specialties: ANTHROPIC_SPECIALTIES[m.id] ?? ['GENERAL', 'VISION'],
  }));
}

const PROJECT_FIELD: ProviderField = {
  key: 'projectId',
  label: 'Id del proyecto de Google Cloud',
  secret: false,
  required: true,
  placeholder: 'mi-proyecto-123',
  pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$',
};

/**
 * Claude en AWS con rol de IAM + ExternalId (plan de mejora L3), sin claves de larga duración. Verificado el 2026-10-24:
 * - platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock: Messages API en
 *   `https://bedrock-mantle.{región}.api.aws/anthropic/v1/messages`, SigV4 con el servicio `bedrock-mantle`, SDK
 *   `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), ids con prefijo `anthropic.`, «IAM assumed roles» con
 *   `bedrock-mantle:CreateInference` y sesión de 12 horas como máximo; sin API de modelos ni fallback server-side.
 * - …/claude-platform-on-aws: `https://aws-external-anthropic.{región}.api.aws`, SigV4 con `aws-external-anthropic`,
 *   cabecera `anthropic-workspace-id` (`wrkspc_…`), SDK `@anthropic-ai/aws-sdk` (`AnthropicAws`, beta), acciones
 *   `aws-external-anthropic:*`, ids iguales a la API de Anthropic, facturación en AWS Marketplace (CCU) y el requisito
 *   `aws iam enable-outbound-web-identity-federation` en la cuenta.
 */
const AWS_REGION_FIELD: ProviderField = {
  key: 'region',
  label: 'Región de AWS',
  secret: false,
  required: true,
  placeholder: 'us-east-1',
  pattern: AWS_REGION_PATTERN,
};

const ROLE_ARN_FIELD: ProviderField = {
  key: 'roleArn',
  label: 'ARN del rol de IAM',
  secret: false,
  required: true,
  placeholder: 'arn:aws:iam::123456789012:role/nexo-claude',
  help: 'Rol de su cuenta con la política de confianza que muestra Nexo (principal de Nexo + ExternalId).',
  pattern: ROLE_ARN_PATTERN,
  mechanisms: ['AWS_ROLE'],
};

const AWS_ROLE_STEPS = (permissions: string) => [
  'Pulse «Generar ExternalId»: Nexo crea un identificador único para esta conexión (no lo elija usted ni lo reutilice).',
  'En la consola de IAM de su cuenta cree un rol con la política de confianza que muestra Nexo: solo el principal de la plataforma Nexo puede asumirlo y solo con ese ExternalId (sts:ExternalId).',
  `Asigne al rol una política de permisos mínima: ${permissions}`,
  'Pegue aquí el ARN del rol. Nexo lo asume con AWS STS en cada sesión (credenciales temporales de una hora) y no guarda ninguna clave.',
];

export const CLAUDE_CHANNEL_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'claude-google-cloud',
    name: 'Claude en Google Cloud',
    description: 'Operado por Anthropic con su cuenta de Google Cloud: inicie sesión con Google, sin claves de API.',
    logo: 'claude-google-cloud',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://claude.googleapis.com',
    auth: 'OAUTH',
    fields: [
      { ...PROJECT_FIELD, help: 'Proyecto suscrito a Claude en Google Cloud Marketplace.' },
      {
        key: 'workspaceId',
        label: 'Workspace de Claude',
        secret: false,
        required: true,
        placeholder: 'wrkspc_01AbCdEf',
        help: 'En la Consola de Claude abierta desde Google Cloud: Settings → Workspaces.',
        pattern: '^wrkspc_[A-Za-z0-9]{4,64}$',
      },
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-google-cloud',
    keySteps: [],
    suggestedModels: claudeModels(false),
    notes:
      'Misma API de Claude (operada por Anthropic), facturada por Google Cloud Marketplace. Requisitos: suscripción en ' +
      'Marketplace, la API claude.googleapis.com habilitada y el rol roles/claude.user para la cuenta que inicia sesión. ' +
      'Es una organización de Anthropic distinta de la de la Consola de Claude. Revise las tarifas en «Modelos de IA».',
    dataNotices: [CLAUDE_COVERED_MODELS_NOTICE],
    pendingVerification: ['tarifas por token de este canal (no publicadas en la fuente consultada)'],
    authHeader: 'bearer',
    family: 'CLAUDE',
    claudeChannel: 'google-cloud',
    mechanisms: [
      {
        type: 'OAUTH',
        label: 'Iniciar sesión con Google',
        primary: true,
        oauth: { ...GOOGLE_CLOUD_OAUTH, appKey: 'vertex' },
      },
    ],
  },
  {
    id: 'claude-vertex',
    name: 'Claude en Vertex AI',
    description: 'Claude operado por Google en Vertex AI: inicie sesión con Google y use su proyecto y región.',
    logo: 'claude-vertex',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://aiplatform.googleapis.com',
    auth: 'OAUTH',
    fields: [
      { ...PROJECT_FIELD, help: 'Proyecto con Vertex AI habilitado y los modelos Claude activados en Model Garden.' },
      {
        key: 'region',
        label: 'Región',
        secret: false,
        required: true,
        placeholder: 'global',
        default: 'global',
        help: '«global» (recomendada), «us», «eu» o una región de Vertex AI (p. ej. us-east5).',
        pattern: '^(global|us|eu|[a-z]+-[a-z]+[0-9]+)$',
      },
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai',
    keySteps: [],
    suggestedModels: claudeModels(false),
    notes:
      'Operado y facturado por Google con sus tarifas: complételas en «Modelos de IA». Active cada modelo Claude en ' +
      'Model Garden. Algunas funciones de la API de Anthropic no están disponibles en Vertex AI (p. ej. web fetch y el ' +
      'fallback server-side).',
    dataNotices: [CLAUDE_COVERED_MODELS_NOTICE],
    pendingVerification: [],
    authHeader: 'bearer',
    // Vertex AI no ofrece API de modelos: se verifica con un conteo de tokens (404 si el modelo no está activado).
    verifyMode: 'lenient',
    family: 'CLAUDE',
    claudeChannel: 'vertex',
    mechanisms: [
      {
        type: 'OAUTH',
        label: 'Iniciar sesión con Google',
        primary: true,
        oauth: { ...GOOGLE_CLOUD_OAUTH, appKey: 'vertex' },
      },
    ],
  },
  {
    id: 'claude-foundry',
    name: 'Claude en Microsoft Foundry',
    description: 'Claude en su recurso de Microsoft Foundry (Azure), facturado por Microsoft Marketplace.',
    logo: 'claude-foundry',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://{{ resource }}.services.ai.azure.com/anthropic',
    auth: 'API_KEY',
    fields: [
      {
        key: 'resource',
        label: 'Nombre del recurso de Foundry',
        secret: false,
        required: true,
        placeholder: 'mi-recurso',
        help: 'El nombre de https://<recurso>.services.ai.azure.com.',
        pattern: '^[a-z0-9][a-z0-9-]{1,62}$',
      },
      API_KEY_FIELD({
        label: 'Clave del recurso',
        help: 'Clave del recurso de Foundry; se guarda cifrada.',
        mechanisms: ['API_KEY'],
      }),
      {
        key: 'tenantId',
        label: 'Inquilino de Entra ID',
        secret: false,
        required: false,
        placeholder: 'organizations',
        default: 'organizations',
        help: 'Id o dominio del inquilino de Microsoft Entra ID del recurso; «organizations» acepta cualquier cuenta profesional.',
        pattern: '^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$',
        mechanisms: ['OAUTH'],
      },
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry',
    keySteps: [
      'En el portal de Azure AI Foundry, despliegue los modelos Claude en su recurso.',
      'Abra el recurso y copie una de sus claves.',
      'Use como modelo el nombre del despliegue (por defecto, el id del modelo, p. ej. claude-opus-5-5).',
    ],
    suggestedModels: claudeModels(true),
    notes:
      'Facturado por Microsoft Marketplace con las tarifas de la API de Anthropic. Con «Iniciar sesión con Microsoft», su ' +
      'cuenta necesita un rol de Azure RBAC sobre el recurso, como «Foundry User» (antes «Azure AI User») o «Cognitive ' +
      'Services User», y el recurso debe tener habilitada la autenticación con Entra ID; el token se renueva solo.',
    dataNotices: [
      {
        level: 'info',
        text:
          'En los despliegues alojados en Azure, los prompts y las respuestas permanecen en Azure; solo los metadatos de ' +
          'uso y el contenido marcado por los sistemas de seguridad de Anthropic salen hacia Anthropic.',
        sourceUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry',
      },
      CLAUDE_COVERED_MODELS_NOTICE,
    ],
    pendingVerification: ['permiso delegado de la app de Nexo para el recurso https://ai.azure.com en Entra ID'],
    authHeader: 'api-key',
    verifyMode: 'lenient',
    family: 'CLAUDE',
    claudeChannel: 'foundry',
    mechanisms: [
      {
        type: 'OAUTH',
        label: 'Iniciar sesión con Microsoft',
        primary: true,
        oauth: { ...ENTRA_AI_OAUTH, appKey: 'azure-openai' },
      },
      { type: 'API_KEY', label: 'Clave del recurso', primary: false },
    ],
  },
  {
    id: 'claude-bedrock',
    name: 'Claude en Amazon Bedrock',
    description:
      'Claude operado por AWS en Amazon Bedrock con un rol de IAM de su cuenta, sin claves de larga duración.',
    logo: 'claude-bedrock',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://bedrock-mantle.{{ region }}.api.aws/anthropic',
    auth: 'NONE',
    fields: [
      { ...AWS_REGION_FIELD, help: 'Región de Bedrock con los modelos Claude habilitados (p. ej. us-east-1).' },
      ROLE_ARN_FIELD,
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock',
    keySteps: [],
    suggestedModels: claudeModels(false, 'anthropic.'),
    notes:
      'Operado y facturado por AWS (los endpoints regionales cuestan un 10 % más que los globales): complete las tarifas ' +
      'en «Modelos de IA». Habilite el acceso a los modelos Claude en Amazon Bedrock. No admite servidor de herramientas ' +
      'remotas, Files API, lotes, API de modelos ni el fallback server-side.',
    dataNotices: [
      {
        level: 'info',
        text: 'Claude en Amazon Bedrock corre en infraestructura gestionada por AWS sin acceso de operadores de Anthropic; el tratamiento de los datos lo rige Amazon Bedrock.',
        sourceUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock',
      },
      CLAUDE_COVERED_MODELS_NOTICE,
    ],
    pendingVerification: [
      'ARN de recurso de los modelos en bedrock-mantle para restringir la política de permisos (la plantilla usa Resource: *)',
      'conteo de tokens (count_tokens) en bedrock-mantle: si no existe, la verificación tolera el 404 tras asumir el rol',
      'tarifas por token de este canal',
    ],
    authHeader: 'none',
    verifyMode: 'lenient',
    family: 'CLAUDE',
    claudeChannel: 'bedrock',
    mechanisms: [
      {
        type: 'AWS_ROLE',
        label: 'Rol de IAM de AWS (sin claves)',
        primary: true,
        steps: AWS_ROLE_STEPS('bedrock-mantle:CreateInference (Nexo muestra la plantilla).'),
      },
    ],
  },
  {
    id: 'claude-aws',
    name: 'Claude Platform on AWS',
    description:
      'Plataforma de Claude operada por Anthropic con su cuenta de AWS: rol de IAM y facturación en AWS Marketplace.',
    logo: 'claude-aws',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://aws-external-anthropic.{{ region }}.api.aws',
    auth: 'NONE',
    fields: [
      { ...AWS_REGION_FIELD, help: 'Región del endpoint (p. ej. us-west-2); no fija dónde se procesa la inferencia.' },
      {
        key: 'workspaceId',
        label: 'Workspace de Claude',
        secret: false,
        required: true,
        placeholder: 'wrkspc_01AbCdEf',
        help: 'En la Consola de Claude abierta desde la consola de AWS: Settings → Workspaces.',
        pattern: ANTHROPIC_WORKSPACE_PATTERN,
      },
      ROLE_ARN_FIELD,
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws',
    keySteps: [],
    suggestedModels: claudeModels(false),
    notes:
      'Facturado por AWS Marketplace en Claude Consumption Units (CCU): complete las tarifas en «Modelos de IA». Es una ' +
      'organización de Anthropic distinta de la de la Consola de Claude. En la cuenta de AWS ejecute una vez ' +
      '«aws iam enable-outbound-web-identity-federation»; sin ese paso todas las solicitudes fallan.',
    dataNotices: [CLAUDE_COVERED_MODELS_NOTICE],
    pendingVerification: [
      'tarifas por token en CCU (platform.claude.com/docs/en/about-claude/pricing#claude-platform-on-aws-pricing)',
      'fallback server-side en este canal (no figura entre las funciones admitidas ni excluidas)',
    ],
    authHeader: 'none',
    family: 'CLAUDE',
    claudeChannel: 'aws',
    mechanisms: [
      {
        type: 'AWS_ROLE',
        label: 'Rol de IAM de AWS (sin claves)',
        primary: true,
        steps: AWS_ROLE_STEPS(
          'aws-external-anthropic:CreateInference, CountTokens, GetModel, ListModels y GetWorkspace sobre el ARN de su workspace (Nexo muestra la plantilla).',
        ),
      },
    ],
  },
];

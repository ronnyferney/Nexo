import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { ECR_REPOSITORIES } from './registry-stack';

export interface NexoPilotStackProps extends cdk.StackProps {
  /**
   * Dominio público del piloto (obligatorio salvo `allowInsecureHttp`). Requiere `hostedZoneId` + `hostedZoneName`
   * (certificado ACM validado por DNS y registro alias automáticos) o `certificateArn` (certificado ACM existente; el
   * registro DNS hacia el balanceador se crea fuera de AWS).
   */
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  /** ARN de un certificado ACM ya emitido para `domainName` (alternativa a la zona de Route 53). */
  certificateArn?: string;
  /**
   * Modo explícito de SOLO PRUEBAS: publica por HTTP en claro en el DNS del balanceador (contraseñas, JWT y tokens
   * viajan sin cifrar). Nunca con datos ni usuarios reales. Sin dominio y sin este modo, el despliegue falla.
   */
  allowInsecureHttp?: boolean;
  /** ECS Exec (`aws ecs execute-command`) en la API y los workers. Desactivado por defecto; activar solo bajo demanda. */
  enableExecuteCommand?: boolean;
  /**
   * Versión publicada a desplegar (p. ej. 1.4.0): usa las imágenes inmutables de ECR con esa etiqueta.
   * Sin versión se construyen las imágenes desde el código local (solo para pruebas).
   */
  imageTag?: string;
  /** Correos de los administradores de la plataforma Nexo (consola de plataforma, ADR 0006 D6), separados por coma. */
  platformAdminEmails?: string;
  /**
   * Correo del usuario maestro: se crea en el primer arranque como OWNER del workspace "Nexo" y como administrador
   * de la plataforma. Su contraseña inicial se genera en Secrets Manager (salida MasterUserSecretArn).
   */
  adminEmail?: string;
}

const ROOT = path.join(__dirname, '..', '..');
/** Caracteres excluidos de la contraseña de la BD para poder usarla en una URL de conexión sin codificar. */
const URL_UNSAFE = ' %+~`#$&*()|[]{}:;<>?!\'/@"\\=,^';
/**
 * HSTS que el balanceador fija en todas las respuestas HTTPS (también las de la API y los errores del propio ALB):
 * 1 año, igual que nginx (apps/web/nginx.conf). Sin `includeSubDomains` ni `preload`: no debe afectar a otros
 * subdominios del cliente y debe poder retirarse.
 */
const HSTS_HEADER = 'max-age=31536000';
/** Para que ENCRYPTION_KEY (clave legacy k0) sea hexadecimal (64 caracteres = 32 bytes), se excluye todo lo que no sea [0-9a-fA-F]. */
const NON_HEX_LETTERS = 'ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ';
/**
 * Apps OAuth de la plataforma (`OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`, ver apps/api/src/modules/oauth/oauth.providers.ts).
 * Viven como claves del secreto de la app (vacías = sin app de plataforma: los clientes usan su app propia).
 */
const OAUTH_PLATFORM_KEYS = [
  'HUBSPOT',
  'GOOGLE',
  'MICROSOFT',
  'SALESFORCE',
  'LINKEDIN',
  'SLACK',
  // Apps de Nexo para iniciar sesión en proveedores IA (`OAUTH_LLM_<PROVEEDOR>_*`, ADR 0002 D8). En un despliegue
  // existente, agregue estas claves (vacías) al secreto de la app ANTES de desplegar: ECS no arranca si falta una clave.
  'LLM_VERTEX',
  'LLM_AZURE_OPENAI',
  'LLM_HUGGINGFACE',
].flatMap((p) => [`OAUTH_${p}_CLIENT_ID`, `OAUTH_${p}_CLIENT_SECRET`]);

/**
 * Piloto de Nexo optimizado en costo, con prácticas de producción:
 * - Red: VPC en 2 zonas sin NAT (tareas Fargate en subredes públicas con IP pública, protegidas por security groups;
 *   base de datos y Redis en subredes aisladas sin salida a internet).
 * - Datos: RDS PostgreSQL 16 cifrado, con protección contra borrado, backups de 7 días y snapshot al eliminar;
 *   ElastiCache Redis 7 con `noeviction` (requisito de BullMQ), AUTH (token en Secrets Manager) y TLS en tránsito.
 * - Cómputo: ECS Fargate con tres servicios (API, workers y web) y Service Connect (la web llega a la API como `api:3000`).
 * - Secretos en Secrets Manager inyectados como variables de entorno (nunca en la imagen ni en el código).
 * - Balanceador con timeout de 600 s (streaming SSE del chat y WebSocket de Nexo Edge), solo HTTPS (80 redirige a
 *   443) con HSTS. HTTP en claro únicamente con el modo explícito de pruebas `allowInsecureHttp`.
 */
export class NexoPilotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NexoPilotStackProps) {
    super(scope, id, props);
    const resolved = resolveTlsMode(props);
    // Error de anotación, no excepción: `cdk deploy NexoRegistry`/`NexoGithubOidc` sintetizan toda la app y no deben
    // fallar por el piloto; el CLI solo bloquea la síntesis o el despliegue que incluye este stack.
    if ('error' in resolved) cdk.Annotations.of(this).addError(resolved.error);
    const tls: TlsMode = 'error' in resolved ? { mode: 'insecure' } : resolved;
    if (tls.mode === 'insecure' && !('error' in resolved)) {
      const warning =
        'MODO SOLO PRUEBAS (allowInsecureHttp): el piloto se publica por HTTP EN CLARO. Contraseñas, JWT y tokens ' +
        'viajan sin cifrar. No use datos ni usuarios reales; configure domainName para HTTPS.';
      cdk.Annotations.of(this).addWarning(warning);
      console.warn(`\n${'!'.repeat(100)}\n!! ${warning}\n${'!'.repeat(100)}\n`);
    }
    const execEnabled = props.enableExecuteCommand ?? false;

    // ---------- Red ----------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'publica', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'datos', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'Nexo - balanceador publico' });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), tls.mode === 'insecure' ? 'HTTP' : 'HTTP (redirige a HTTPS)');
    if (tls.mode !== 'insecure') albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    const webSg = new ec2.SecurityGroup(this, 'WebSg', { vpc, description: 'Nexo - web nginx' });
    webSg.addIngressRule(albSg, ec2.Port.tcp(80), 'Desde el balanceador');
    const apiSg = new ec2.SecurityGroup(this, 'ApiSg', { vpc, description: 'Nexo - API' });
    apiSg.addIngressRule(webSg, ec2.Port.tcp(3000), 'Desde la web (Service Connect)');
    const workerSg = new ec2.SecurityGroup(this, 'WorkerSg', { vpc, description: 'Nexo - workers' });
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'Nexo - PostgreSQL', allowAllOutbound: false });
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', { vpc, description: 'Nexo - Redis', allowAllOutbound: false });
    // Las descripciones de reglas EC2 solo admiten ASCII.
    for (const sg of [apiSg, workerSg]) {
      dbSg.addIngressRule(sg, ec2.Port.tcp(5432), 'PostgreSQL desde API/workers');
      redisSg.addIngressRule(sg, ec2.Port.tcp(6379), 'Redis desde API/workers');
    }

    // ---------- Datos ----------
    const db = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: 'nexo',
      credentials: rds.Credentials.fromGeneratedSecret('nexo', { excludeCharacters: URL_UNSAFE }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      multiAz: false,
      publiclyAccessible: false,
      // B8: CloudFormation no puede borrar la base por error (cdk destroy, reemplazo); al eliminarla deja un snapshot.
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    });

    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Subredes aisladas de Redis',
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });
    const redisParams = new elasticache.CfnParameterGroup(this, 'RedisParams', {
      cacheParameterGroupFamily: 'redis7',
      description: 'BullMQ requiere maxmemory-policy noeviction',
      properties: { 'maxmemory-policy': 'noeviction' },
    });
    // B8: AUTH y TLS en tránsito exigen un grupo de replicación (CfnCacheCluster no admite token AUTH). El token vive
    // en Secrets Manager: 64 caracteres alfanuméricos (ElastiCache no admite `@`, `"` ni `/`).
    const redisAuthSecret = new secretsmanager.Secret(this, 'RedisAuthToken', {
      description: 'Nexo: token AUTH de ElastiCache Redis (REDIS_PASSWORD de la API y los workers)',
      generateSecretString: { passwordLength: 64, excludePunctuation: true, includeSpace: false },
    });
    const redis = new elasticache.CfnReplicationGroup(this, 'RedisGroup', {
      replicationGroupDescription: 'Nexo - colas BullMQ y limitador (TLS + AUTH)',
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      cacheSubnetGroupName: redisSubnets.ref,
      cacheParameterGroupName: redisParams.ref,
      securityGroupIds: [redisSg.securityGroupId],
      transitEncryptionEnabled: true,
      transitEncryptionMode: 'required',
      atRestEncryptionEnabled: true,
      // Referencia dinámica de CloudFormation: el token no queda en la plantilla sintetizada.
      authToken: redisAuthSecret.secretValue.unsafeUnwrap(),
    });

    // ---------- Secretos ----------
    const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      description:
        'Nexo: JWT_SECRET (generado), ANTHROPIC_API_KEY y apps OAuth de la plataforma OAUTH_* (opcionales; completar ' +
        'tras el despliegue)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          ANTHROPIC_API_KEY: '',
          ...Object.fromEntries(OAUTH_PLATFORM_KEYS.map((k) => [k, ''])),
        }),
        generateStringKey: 'JWT_SECRET',
        passwordLength: 64,
        excludePunctuation: true,
      },
    });
    // Contraseña inicial del usuario maestro: generada aquí, nunca en el código ni en GitHub. Debe cambiarse al entrar.
    const masterUserSecret = new secretsmanager.Secret(this, 'MasterUser', {
      description: 'Nexo: contraseña inicial del usuario maestro (cámbiela al primer ingreso)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ email: props.adminEmail ?? '' }),
        generateStringKey: 'password',
        passwordLength: 24,
        excludeCharacters: '"\\\'`',
      },
    });
    // Clave legacy (kid k0). Su valor no se reemplaza nunca: descifra lo cifrado con ella hasta completar la rotación.
    // No cambie su id lógico ni `generateSecretString`: CloudFormation generaría otra clave y los datos dejarían de
    // descifrarse.
    const encryptionSecret = new secretsmanager.Secret(this, 'EncryptionKey', {
      description:
        'Nexo: ENCRYPTION_KEY, clave legacy k0 (32 bytes en hex). No reemplace su valor: para rotar use el secreto ' +
        'EncryptionKeyring (docs/rotacion-de-claves.md).',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
        excludeCharacters: NON_HEX_LETTERS,
      },
    });
    // Rotación de claves (B7, docs/rotacion-de-claves.md): claves adicionales `kid:hex` y kid activo. Se crea vacío
    // (solo k0) y se completa a mano en Secrets Manager; los valores se leen al arrancar cada tarea, así que tras
    // editarlo hay que reemplazar las tareas de api y worker (`aws ecs update-service --force-new-deployment`).
    // No cambie esta plantilla en un despliegue existente: CloudFormation reescribiría el secreto con valores vacíos
    // y la API dejaría de descifrar lo cifrado con las claves nuevas.
    const encryptionKeyringSecret = new secretsmanager.Secret(this, 'EncryptionKeyring', {
      description:
        'Nexo: rotación de claves de cifrado. ENCRYPTION_KEYS (kid:hex separados por coma), ENCRYPTION_ACTIVE_KID ' +
        '(vacío = k0) y ENCRYPTION_LEGACY_READS (false solo tras rotar todo).',
      secretObjectValue: {
        ENCRYPTION_KEYS: cdk.SecretValue.unsafePlainText(''),
        ENCRYPTION_ACTIVE_KID: cdk.SecretValue.unsafePlainText(''),
        ENCRYPTION_LEGACY_READS: cdk.SecretValue.unsafePlainText(''),
      },
    });

    // ---------- Cómputo ----------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    cluster.addDefaultCloudMapNamespace({ name: 'nexo.local', useForServiceConnect: true });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(600),
    });
    const publicUrl = tls.mode === 'insecure' ? `http://${alb.loadBalancerDnsName}` : `https://${tls.domainName}`;

    const image = (app: keyof typeof ECR_REPOSITORIES) =>
      props.imageTag
        ? ecs.ContainerImage.fromEcrRepository(
            ecr.Repository.fromRepositoryName(this, `${app}Repo`, ECR_REPOSITORIES[app]),
            props.imageTag,
          )
        : ecs.ContainerImage.fromAsset(path.join(ROOT, 'apps', app), { platform: Platform.LINUX_AMD64 });
    const apiImage = image('api');
    const webImage = image('web');
    if (props.imageTag) cdk.Tags.of(this).add('nexo:version', props.imageTag);

    const apiEnv: Record<string, string> = {
      NODE_ENV: 'production',
      PORT: '3000',
      LOG_LEVEL: 'info',
      DB_HOST: db.dbInstanceEndpointAddress,
      DB_PORT: db.dbInstanceEndpointPort,
      DB_NAME: 'nexo',
      DB_SSLMODE: 'require',
      DB_SSLCERT: '/app/certs/rds-global-bundle.pem',
      REDIS_HOST: redis.attrPrimaryEndPointAddress,
      REDIS_PORT: redis.attrPrimaryEndPointPort,
      REDIS_TLS: 'true',
      PUBLIC_URL: publicUrl,
      WEB_URL: publicUrl,
      CORS_ORIGINS: publicUrl,
      CONNECTOR_ALLOW_PRIVATE_NETWORKS: 'false',
      EXECUTIONS_RETENTION_DAYS: '30',
      WORKER_CONCURRENCY: '10',
      COPILOT_PROVIDER: 'anthropic',
      COPILOT_MODEL: 'claude-opus-5-5',
      COPILOT_MONTHLY_QUOTA_USD: '2',
      // `||`: una variable de GitHub sin definir llega como '' y debe caer al usuario maestro.
      PLATFORM_ADMIN_EMAILS: props.platformAdminEmails || props.adminEmail || '',
    };
    const apiSecrets: Record<string, ecs.Secret> = {
      DB_USER: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
      JWT_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'JWT_SECRET'),
      ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecret, 'ANTHROPIC_API_KEY'),
      ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(encryptionSecret),
      ENCRYPTION_KEYS: ecs.Secret.fromSecretsManager(encryptionKeyringSecret, 'ENCRYPTION_KEYS'),
      ENCRYPTION_ACTIVE_KID: ecs.Secret.fromSecretsManager(encryptionKeyringSecret, 'ENCRYPTION_ACTIVE_KID'),
      ENCRYPTION_LEGACY_READS: ecs.Secret.fromSecretsManager(encryptionKeyringSecret, 'ENCRYPTION_LEGACY_READS'),
      REDIS_PASSWORD: ecs.Secret.fromSecretsManager(redisAuthSecret),
      ...Object.fromEntries(OAUTH_PLATFORM_KEYS.map((k) => [k, ecs.Secret.fromSecretsManager(appSecret, k)])),
    };
    // Solo la API crea el usuario maestro (el worker no recibe la contraseña).
    const bootstrapEnv: Record<string, string> = props.adminEmail
      ? { BOOTSTRAP_ADMIN_EMAIL: props.adminEmail, BOOTSTRAP_WORKSPACE_NAME: 'Nexo' }
      : {};
    const bootstrapSecrets: Record<string, ecs.Secret> = props.adminEmail
      ? { BOOTSTRAP_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(masterUserSecret, 'password') }
      : {};
    const logDriver = (prefix: string) =>
      ecs.LogDrivers.awsLogs({ streamPrefix: prefix, logRetention: logs.RetentionDays.ONE_MONTH });

    // API HTTP (migra la base de datos al arrancar; no procesa colas).
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', { cpu: 512, memoryLimitMiB: 1024 });
    apiTask.addContainer('api', {
      image: apiImage,
      environment: { ...apiEnv, ...bootstrapEnv, WORKER_ENABLED: 'false', RUN_MIGRATIONS: 'true' },
      secrets: { ...apiSecrets, ...bootstrapSecrets },
      portMappings: [{ name: 'api', containerPort: 3000, appProtocol: ecs.AppProtocol.http }],
      logging: logDriver('api'),
      healthCheck: {
        command: ['CMD-SHELL', "node -e \"fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(90),
      },
    });
    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: apiTask,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [apiSg],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      enableExecuteCommand: execEnabled,
      serviceConnectConfiguration: { services: [{ portMappingName: 'api', dnsName: 'api', port: 3000 }] },
    });

    // Workers (flujos, rutinas, evaluaciones). No migran ni reciben tráfico.
    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', { cpu: 512, memoryLimitMiB: 1024 });
    workerTask.addContainer('worker', {
      image: apiImage,
      environment: { ...apiEnv, WORKER_ENABLED: 'true', RUN_MIGRATIONS: 'false' },
      secrets: apiSecrets,
      logging: logDriver('worker'),
    });
    const workerService = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [workerSg],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      enableExecuteCommand: execEnabled,
    });
    workerService.node.addDependency(apiService); // las migraciones corren primero en la API

    // Web (nginx): sirve Angular y reenvía /api a `api:3000` por Service Connect.
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', { cpu: 256, memoryLimitMiB: 512 });
    webTask.addContainer('web', {
      image: webImage,
      portMappings: [{ name: 'web', containerPort: 80, appProtocol: ecs.AppProtocol.http }],
      logging: logDriver('web'),
    });
    const webService = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [webSg],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      serviceConnectConfiguration: {},
    });
    webService.node.addDependency(apiService);

    // Autoescalado básico (piloto: 1–3 tareas).
    for (const [svc, max] of [
      [apiService, 3],
      [workerService, 3],
    ] as const) {
      svc.autoScaleTaskCount({ minCapacity: 1, maxCapacity: max }).scaleOnCpuUtilization('Cpu', {
        targetUtilizationPercent: 70,
      });
    }

    // ---------- Balanceador / dominio ----------
    const targetProps: elbv2.AddApplicationTargetsProps = {
      port: 80,
      targets: [webService],
      healthCheck: { path: '/', healthyHttpCodes: '200', interval: cdk.Duration.seconds(30) },
      deregistrationDelay: cdk.Duration.seconds(30),
    };
    if (tls.mode === 'insecure') {
      alb.addListener('Http', { port: 80 }).addTargets('Web', targetProps);
    } else {
      const zone =
        tls.mode === 'route53'
          ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
              hostedZoneId: tls.hostedZoneId,
              zoneName: tls.hostedZoneName,
            })
          : undefined;
      const certificate =
        tls.mode === 'certificate'
          ? acm.Certificate.fromCertificateArn(this, 'Certificate', tls.certificateArn)
          : new acm.Certificate(this, 'Certificate', {
              domainName: tls.domainName,
              validation: acm.CertificateValidation.fromDns(zone),
            });
      const https = alb.addListener('Https', {
        port: 443,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      });
      https.addTargets('Web', targetProps);
      // HSTS en el balanceador: el navegador no vuelve a intentar HTTP tras la primera visita.
      https.setAttribute('routing.http.response.strict_transport_security.header_value', HSTS_HEADER);
      // 80 → 443 (301). Mismo id lógico que el oyente HTTP del modo de pruebas: al pasar de HTTP a HTTPS,
      // CloudFormation actualiza el oyente del puerto 80 en lugar de crear otro (chocaría por el puerto).
      alb.addListener('Http', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
      if (zone) {
        new route53.ARecord(this, 'Alias', {
          zone,
          recordName: tls.domainName,
          target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
        });
      } else {
        new cdk.CfnOutput(this, 'DnsTarget', {
          value: alb.loadBalancerDnsName,
          description: `Cree un CNAME de ${tls.domainName} hacia este nombre (el DNS no está en Route 53)`,
        });
      }
    }

    // ---------- Salidas ----------
    new cdk.CfnOutput(this, 'Url', { value: publicUrl, description: 'URL del piloto de Nexo' });
    new cdk.CfnOutput(this, 'Version', { value: props.imageTag ?? 'local', description: 'Versión desplegada' });
    new cdk.CfnOutput(this, 'MasterUserSecretArn', {
      value: masterUserSecret.secretArn,
      description: 'Usuario maestro: correo y contraseña inicial (Secrets Manager → Recuperar valor del secreto)',
    });
    new cdk.CfnOutput(this, 'AppSecretArn', {
      value: appSecret.secretArn,
      description: 'Complete ANTHROPIC_API_KEY en este secreto y reinicie los servicios api y worker',
    });
    new cdk.CfnOutput(this, 'DatabaseEndpoint', { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'RedisAuthSecretArn', {
      value: redisAuthSecret.secretArn,
      description: 'Token AUTH de Redis (inyectado como REDIS_PASSWORD; rotarlo exige actualizar ElastiCache)',
    });
    new cdk.CfnOutput(this, 'EncryptionKeyringSecretArn', {
      value: encryptionKeyringSecret.secretArn,
      description: 'Rotación de claves: ENCRYPTION_KEYS y ENCRYPTION_ACTIVE_KID (docs/rotacion-de-claves.md)',
    });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}

export type TlsMode =
  | { mode: 'route53'; domainName: string; hostedZoneId: string; hostedZoneName: string }
  | { mode: 'certificate'; domainName: string; certificateArn: string }
  | { mode: 'insecure' };

/**
 * M7: decide cómo se publica el piloto. Con dominio exige certificado (zona de Route 53 o ARN de ACM); sin dominio solo
 * se permite HTTP con el modo explícito de pruebas. Cualquier otra combinación devuelve un error que bloquea el stack.
 */
export function resolveTlsMode(props: NexoPilotStackProps): TlsMode | { error: string } {
  const domainName = props.domainName?.trim();
  const hostedZoneId = props.hostedZoneId?.trim();
  const hostedZoneName = props.hostedZoneName?.trim();
  const certificateArn = props.certificateArn?.trim();
  if (domainName) {
    if (certificateArn) return { mode: 'certificate', domainName, certificateArn };
    if (hostedZoneId && hostedZoneName) return { mode: 'route53', domainName, hostedZoneId, hostedZoneName };
    return {
      error: `domainName=${domainName} requiere hostedZoneId y hostedZoneName (Route 53) o certificateArn (ACM) para HTTPS.`,
    };
  }
  if (props.allowInsecureHttp) return { mode: 'insecure' };
  return {
    error:
      'El piloto no se publica por HTTP en claro: defina domainName con hostedZoneId/hostedZoneName o certificateArn. ' +
      'Solo para pruebas sin datos reales: -c allowInsecureHttp=true.',
  };
}

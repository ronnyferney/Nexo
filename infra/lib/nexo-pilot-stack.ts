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
  /** Dominio público (opcional). Sin dominio se publica por HTTP en el DNS del balanceador. */
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
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
/** Para que ENCRYPTION_KEY sea hexadecimal (64 caracteres = 32 bytes), se excluye todo lo que no sea [0-9a-fA-F]. */
const NON_HEX_LETTERS = 'ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ';

/**
 * Piloto de Nexo optimizado en costo, con prácticas de producción:
 * - Red: VPC en 2 zonas sin NAT (tareas Fargate en subredes públicas con IP pública, protegidas por security groups;
 *   base de datos y Redis en subredes aisladas sin salida a internet).
 * - Datos: RDS PostgreSQL 16 cifrado con backups de 7 días y snapshot al eliminar; ElastiCache Redis 7 con `noeviction`
 *   (requisito de BullMQ).
 * - Cómputo: ECS Fargate con tres servicios (API, workers y web) y Service Connect (la web llega a la API como `api:3000`).
 * - Secretos en Secrets Manager inyectados como variables de entorno (nunca en la imagen ni en el código).
 * - Balanceador con timeout de 600 s (streaming SSE del chat y WebSocket de Nexo Edge) y HTTPS si hay dominio.
 */
export class NexoPilotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NexoPilotStackProps) {
    super(scope, id, props);

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
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
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
      deletionProtection: false,
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
    const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t4g.micro',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnets.ref,
      cacheParameterGroupName: redisParams.ref,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
    });

    // ---------- Secretos ----------
    const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      description: 'Nexo: JWT_SECRET (generado) y ANTHROPIC_API_KEY (completar tras el despliegue)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ ANTHROPIC_API_KEY: '' }),
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
    const encryptionSecret = new secretsmanager.Secret(this, 'EncryptionKey', {
      description: 'Nexo: ENCRYPTION_KEY (32 bytes en hex). NO ROTAR: cifra los secretos de los clientes.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
        excludeCharacters: NON_HEX_LETTERS,
      },
    });

    // ---------- Cómputo ----------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    cluster.addDefaultCloudMapNamespace({ name: 'nexo.local', useForServiceConnect: true });

    const scheme = props.domainName ? 'https' : 'http';
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(600),
    });
    const publicUrl = props.domainName ? `https://${props.domainName}` : `http://${alb.loadBalancerDnsName}`;

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
      REDIS_HOST: redis.attrRedisEndpointAddress,
      REDIS_PORT: redis.attrRedisEndpointPort,
      PUBLIC_URL: publicUrl,
      WEB_URL: publicUrl,
      CORS_ORIGINS: publicUrl,
      CONNECTOR_ALLOW_PRIVATE_NETWORKS: 'false',
      EXECUTIONS_RETENTION_DAYS: '30',
      WORKER_CONCURRENCY: '10',
      COPILOT_PROVIDER: 'anthropic',
      COPILOT_MODEL: 'claude-opus-5-5',
      COPILOT_MONTHLY_QUOTA_USD: '2',
      PLATFORM_ADMIN_EMAILS: props.platformAdminEmails ?? props.adminEmail ?? '',
    };
    const apiSecrets: Record<string, ecs.Secret> = {
      DB_USER: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
      JWT_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'JWT_SECRET'),
      ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecret, 'ANTHROPIC_API_KEY'),
      ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(encryptionSecret),
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
      enableExecuteCommand: true,
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
      enableExecuteCommand: true,
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
    if (props.domainName && props.hostedZoneId && props.hostedZoneName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.hostedZoneName,
      });
      const certificate = new acm.Certificate(this, 'Certificate', {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
      alb.addListener('Https', { port: 443, certificates: [certificate], sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS })
        .addTargets('Web', targetProps);
      alb.addRedirect({ sourcePort: 80, targetPort: 443 });
      new route53.ARecord(this, 'Alias', {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      });
    } else {
      alb.addListener('Http', { port: 80 }).addTargets('Web', targetProps);
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
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
  }
}

import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import type { Construct } from 'constructs';

/** Repositorios de las imágenes que se despliegan en AWS (la imagen del Edge se distribuye por GHCR). */
export const ECR_REPOSITORIES = { api: 'nexo/api', web: 'nexo/web' } as const;

/**
 * Registro de imágenes versionadas para el despliegue: etiquetas inmutables (una versión nunca cambia de contenido),
 * análisis de vulnerabilidades al subir y retención de las últimas 30 imágenes. Se conserva al eliminar el stack.
 */
export class RegistryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    for (const [key, repositoryName] of Object.entries(ECR_REPOSITORIES)) {
      const repo = new ecr.Repository(this, `${key}Repo`, {
        repositoryName,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        encryption: ecr.RepositoryEncryption.AES_256,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        lifecycleRules: [{ description: 'Conservar las últimas 30 imágenes', maxImageCount: 30 }],
      });
      new cdk.CfnOutput(this, `${key}RepositoryUri`, { value: repo.repositoryUri });
    }
  }
}

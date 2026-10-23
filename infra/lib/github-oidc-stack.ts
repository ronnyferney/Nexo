import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { ECR_REPOSITORIES } from './registry-stack';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** owner/repo autorizado. */
  githubRepo: string;
}

/**
 * Rol que GitHub Actions asume por OIDC para desplegar con CDK. Evita guardar llaves de AWS en GitHub.
 * Solo el repositorio indicado (cualquier rama, flujo manual "Desplegar piloto AWS") puede asumirlo.
 * Permisos: asumir los roles de despliegue que crea `cdk bootstrap` (mínimo privilegio recomendado por CDK) y subir
 * imágenes a los repositorios ECR de Nexo.
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GithubProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'nexo-github-deploy',
      maxSessionDuration: cdk.Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:*` },
      }),
      description: `Despliegue de Nexo desde GitHub Actions (${props.githubRepo})`,
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:${cdk.Aws.PARTITION}:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-*`],
      }),
    );

    // Publicación de la versión: copiar las imágenes de GHCR a ECR (solo los repositorios de Nexo).
    role.addToPolicy(new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:DescribeImages',
          'ecr:GetDownloadUrlForLayer',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
        ],
        resources: Object.values(ECR_REPOSITORIES).map(
          (name) => `arn:${cdk.Aws.PARTITION}:ecr:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:repository/${name}`,
        ),
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: role.roleArn,
      description: 'Guárdelo como secreto AWS_DEPLOY_ROLE_ARN en GitHub',
    });
  }
}

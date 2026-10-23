#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { NexoPilotStack } from '../lib/nexo-pilot-stack';
import { RegistryStack } from '../lib/registry-stack';

/**
 * Parámetros (contexto CDK, `-c clave=valor`, o variables de entorno):
 *   domainName      Dominio del piloto (p. ej. nexo.phari.co). Opcional: sin él se publica por HTTP en el DNS del ALB.
 *   hostedZoneId    Zona de Route 53 del dominio (obligatoria si hay dominio y se quiere certificado automático).
 *   hostedZoneName  Nombre de la zona (p. ej. phari.co).
 *   githubRepo      Repositorio autorizado a desplegar por OIDC (por defecto ronnyferney/Nexo).
 *   imageTag        Versión publicada a desplegar (p. ej. 1.4.0, imágenes de ECR). Sin ella se construye desde el código.
 */
const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
};
const ctx = (key: string) => app.node.tryGetContext(key) ?? process.env[key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()];

new NexoPilotStack(app, 'NexoPilot', {
  env,
  domainName: ctx('domainName'),
  hostedZoneId: ctx('hostedZoneId'),
  hostedZoneName: ctx('hostedZoneName'),
  imageTag: ctx('imageTag'),
  description: 'Nexo — piloto: API, workers y web en ECS Fargate, PostgreSQL (RDS) y Redis (ElastiCache)',
});

new RegistryStack(app, 'NexoRegistry', {
  env,
  description: 'Nexo — repositorios ECR de imágenes versionadas (etiquetas inmutables)',
});

new GithubOidcStack(app, 'NexoGithubOidc', {
  env,
  githubRepo: ctx('githubRepo') ?? 'ronnyferney/Nexo',
  description: 'Nexo — rol de despliegue para GitHub Actions por OIDC (sin llaves de larga duración)',
});

#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { NexoPilotStack } from '../lib/nexo-pilot-stack';
import { RegistryStack } from '../lib/registry-stack';

/**
 * Parámetros (contexto CDK, `-c clave=valor`, o variables de entorno):
 *   domainName      Dominio del piloto (p. ej. nexo.phari.co). Obligatorio: el piloto solo se publica por HTTPS.
 *   hostedZoneId    Zona de Route 53 del dominio (certificado ACM y registro DNS automáticos).
 *   hostedZoneName  Nombre de la zona (p. ej. phari.co).
 *   certificateArn  Certificado ACM existente para domainName (alternativa a la zona; el DNS se crea fuera de AWS).
 *   allowInsecureHttp  `true` = modo SOLO PRUEBAS por HTTP en claro en el DNS del ALB (sin dominio). Nunca con clientes.
 *   enableExecuteCommand  `true` = activa ECS Exec en la API y los workers (por defecto desactivado; solo bajo demanda).
 *   githubRepo      Repositorio autorizado a desplegar por OIDC (por defecto ronnyferney/Nexo).
 *   adminEmail      Correo del usuario maestro (OWNER inicial y administrador de la plataforma).
 *   platformAdminEmails  Correos de administradores de la plataforma Nexo, separados por coma.
 *   imageTag        Versión publicada a desplegar (p. ej. 1.4.0, imágenes de ECR). Sin ella se construye desde el código.
 */
const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
};
const ctx = (key: string) => app.node.tryGetContext(key) ?? process.env[key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()];
/** Banderas booleanas: solo `true` (texto o booleano) las activa; '' de una variable de GitHub sin definir es `false`. */
const flag = (key: string) => String(ctx(key) ?? '').trim().toLowerCase() === 'true';

new NexoPilotStack(app, 'NexoPilot', {
  env,
  domainName: ctx('domainName'),
  hostedZoneId: ctx('hostedZoneId'),
  hostedZoneName: ctx('hostedZoneName'),
  certificateArn: ctx('certificateArn'),
  allowInsecureHttp: flag('allowInsecureHttp'),
  enableExecuteCommand: flag('enableExecuteCommand'),
  imageTag: ctx('imageTag'),
  platformAdminEmails: ctx('platformAdminEmails'),
  adminEmail: ctx('adminEmail'),
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

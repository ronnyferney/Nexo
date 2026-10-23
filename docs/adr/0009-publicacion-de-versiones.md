# 0009. Publicación consistente de versiones

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect, nexo-backend-platform

## Contexto
El piloto se desplegaba construyendo las imágenes desde la rama en cada despliegue (`ContainerImage.fromAsset`): dos
despliegues del mismo código podían producir imágenes distintas, no había versión visible ni notas de cambios, y volver
atrás exigía reconstruir código antiguo.

## Decisiones
1. **Una versión semántica para el monorepo**, deducida de los commits convencionales y aplicada a todos los
   `package.json` por `scripts/release.mjs` (sin dependencias externas, con pruebas `node --test`).
2. **Etiqueta `vX.Y.Z` = versión publicada.** `release.yml` verifica la alineación de versiones, ejecuta el CI completo
   (reutilizado con `workflow_call`, incluidas las E2E con Postgres y Redis) y solo entonces construye una vez las imágenes
   `nexo-api`, `nexo-web` y `nexo-edge` en GHCR con SBOM y procedencia, y crea el GitHub Release con las notas del CHANGELOG.
3. **El despliegue promueve, no construye.** `deploy-aws.yml` recibe una versión, copia sus imágenes a ECR (`NexoRegistry`,
   etiquetas inmutables, análisis al subir) conservando el digest, despliega `NexoPilot` con `imageTag` y verifica que la
   API y la web respondan con esa versión.
4. **Versión observable:** `GET /api/health/version` (público, con throttling global) y `/version.json` en la web.
5. **Reversión = desplegar la versión anterior.** Las migraciones son aditivas para mantener compatibilidad hacia atrás.

## Consecuencias
- Nuevo stack `NexoRegistry`; el rol OIDC gana permisos de subida limitados a `nexo/api` y `nexo/web`.
- `cdk deploy NexoPilot` sin `imageTag` sigue construyendo desde el código local, solo para pruebas.
- El commit `chore(release)` exige que la rama por defecto acepte el push de GitHub Actions (o publicar localmente).

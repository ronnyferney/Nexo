# Publicación de versiones

Nexo se publica como **una sola versión semántica** para todo el monorepo (API, web, Nexo Edge e infraestructura).
Una versión es inmutable: se construye una vez, se prueba una vez y se despliega tal cual en cualquier entorno.

```
commits convencionales ─▶ Preparar versión ─▶ vX.Y.Z (commit + etiqueta) ─▶ Publicar versión ─▶ GitHub Release
                                                                              │  CI completo (tipos, lint, unitarias,
                                                                              │  E2E con Postgres/Redis, build, Edge, CDK)
                                                                              └▶ ghcr.io/<owner>/nexo-{api,web,edge}:X.Y.Z
                                                                                 (SBOM + procedencia)
Desplegar piloto AWS (versión X.Y.Z) ─▶ copia a ECR (mismo digest) ─▶ CDK -c imageTag=X.Y.Z ─▶ verificación de versión
```

## Reglas

- **Versionado semántico** deducido de los commits: `feat:` → *minor*, `fix:`/`perf:` → *patch*, `tipo!:` o
  `BREAKING CHANGE:` en el cuerpo → *major*. `docs:`, `test:`, `refactor:` y `chore:` no publican por sí solos.
- **Una fuente de verdad:** la versión de los `package.json` (raíz, `apps/api`, `apps/web`, `apps/edge`, `infra`), siempre
  alineada; la publicación falla si alguna no coincide con la etiqueta.
- **CHANGELOG.md** se genera desde los commits; las notas del GitHub Release salen de ahí. Se puede editar a mano antes
  de publicar (p. ej. para resaltar cambios de comportamiento).
- **Imágenes inmutables:** GHCR por versión y ECR con etiquetas inmutables. Nunca se reconstruye para desplegar.
- **Trazabilidad:** cada imagen lleva etiquetas OCI (versión, commit, fecha) y la versión en ejecución se consulta en
  `GET /api/health/version` (API) y `/version.json` (web).
- **Migraciones solo hacia adelante y aditivas**, para que volver a la versión anterior siga funcionando.

## Publicar

**Desde GitHub (recomendado):** Actions → **Preparar versión** → *Run workflow* sobre la rama por defecto → incremento
`auto` (o `patch`/`minor`/`major`). Crea el commit `chore(release): vX.Y.Z`, la etiqueta y ejecuta **Publicar versión**.
Si la rama por defecto está protegida, permita el push de GitHub Actions o use la alternativa local.

**Local:**

```bash
npm run release:dry          # muestra la versión calculada y las notas, sin cambiar nada
npm run release              # o: node scripts/release.mjs prepare minor
git push --follow-tags origin HEAD   # la etiqueta dispara "Publicar versión"
```

## Desplegar

Actions → **Desplegar piloto AWS** → versión `X.Y.Z` → `desplegar`. Detalle y requisitos en [deploy-aws.md](deploy-aws.md).
Para volver atrás, despliegue la versión anterior.

## Nexo Edge para clientes

La imagen `ghcr.io/<owner>/nexo-edge:X.Y.Z` acompaña cada versión. Para que los clientes la descarguen sin credenciales,
haga público el paquete `nexo-edge` en GitHub (Packages → nexo-edge → Package settings → Change visibility).

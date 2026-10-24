-- Auditoría A4: secretos permitidos por conector.
-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "allowedSecrets" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Criterio de migración (seguro y compatible): cada conector existente queda autorizado únicamente para los secretos
-- que YA referencia hoy con `{{ secrets.NOMBRE }}` en su configuración, su autenticación o las definiciones de sus
-- operaciones, y que existen en la bóveda de su propio workspace al momento de migrar. Así los conectores en uso
-- siguen funcionando igual; referencias a secretos que aún no existen (o que se añadan después) quedan bloqueadas
-- hasta que un ADMIN las permita.
WITH refs AS (
  SELECT c."id" AS connector_id, c."workspaceId" AS workspace_id, m[1] AS name
  FROM "Connector" c
  CROSS JOIN LATERAL regexp_matches(c."config"::text || ' ' || c."auth"::text,
    '\{\{\s*secrets(?:\.|\[)([A-Z][A-Z0-9_]*)', 'g') AS m
  UNION
  SELECT c."id", c."workspaceId", m[1]
  FROM "Connector" c
  JOIN "ConnectorOperation" o ON o."connectorId" = c."id"
  CROSS JOIN LATERAL regexp_matches(o."definition"::text, '\{\{\s*secrets(?:\.|\[)([A-Z][A-Z0-9_]*)', 'g') AS m
),
allowed AS (
  SELECT r.connector_id, array_agg(DISTINCT r.name ORDER BY r.name) AS names
  FROM refs r
  JOIN "Secret" s ON s."workspaceId" = r.workspace_id AND s."name" = r.name
  GROUP BY r.connector_id
)
UPDATE "Connector" c SET "allowedSecrets" = a.names FROM allowed a WHERE a.connector_id = c."id";

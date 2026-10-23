import type { CatalogEntry } from './catalog.types';
import { gmail } from './integrations/gmail';
import { googleSheets } from './integrations/google-sheets';
import { hubspot } from './integrations/hubspot';
import { linkedin } from './integrations/linkedin';
import { lushaRest } from './integrations/lusha';
import { lushaMcp } from './integrations/lusha-mcp';
import { microsoftOutlook } from './integrations/microsoft-outlook';
import { pipedrive } from './integrations/pipedrive';
import { salesforce } from './integrations/salesforce';
import { slack } from './integrations/slack';
import { whatsapp } from './integrations/whatsapp';

/**
 * Catálogo de conectores nativos (ADR 0005, D2), versionado en código. Agregar una integración = un archivo en
 * `integrations/` + su registro aquí; `catalog.spec.ts` valida ids, esquemas y referencias a secretos.
 */
export const CATALOG: readonly CatalogEntry[] = [
  lushaMcp,
  lushaRest,
  hubspot,
  linkedin,
  salesforce,
  pipedrive,
  googleSheets,
  gmail,
  microsoftOutlook,
  whatsapp,
  slack,
];

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

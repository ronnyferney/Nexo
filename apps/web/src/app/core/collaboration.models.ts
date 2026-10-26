/**
 * Tipos de coordinación transversal (E5 · RF36): canales por misión/proceso/área con hilos. Espejan el contrato del
 * backend (`apps/api/src/modules/collaboration`). Regla central: una solicitud de acción NO ejecuta sola — se
 * convierte en una `Tarea` autorizada solo con autoridad (EDITOR+), nunca por una mención (QA12). Todo filtra por
 * `workspaceId`; mencionar/referenciar no concede acceso.
 */

/** Tipo de canal (espejo del enum `TipoCanal` de Prisma). */
export type TipoCanal = 'MISION' | 'PROCESO' | 'AREA';
export const TIPOS_CANAL: readonly TipoCanal[] = ['MISION', 'PROCESO', 'AREA'];

/** Canal de coordinación. En el listado llega con el conteo de hilos; en el detalle, con sus hilos. */
export interface Canal {
  id: string;
  workspaceId: string;
  orgUnitId: string | null;
  tipo: TipoCanal;
  misionId: string | null;
  nombre: string;
  descripcion: string | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { hilos: number };
  hilos?: HiloCanal[];
}

/** Hilo de un canal. `tareaId` != null cuando una solicitud del hilo ya se convirtió en tarea autorizada. */
export interface HiloCanal {
  id: string;
  workspaceId: string;
  canalId: string;
  asunto: string;
  intercambios: number;
  tareaId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrearCanalInput {
  tipo: TipoCanal;
  nombre: string;
  descripcion?: string;
  orgUnitId?: string;
  misionId?: string;
}

export interface CrearHiloInput {
  asunto: string;
}

/** Convierte una solicitud del hilo en una TAREA autorizada (RF36/D5). Requiere autoridad (EDITOR+). */
export interface ConvertirEnTareaInput {
  titulo: string;
  criterioAceptacion?: string;
  responsableAgentId?: string;
  duenoUserId?: string;
  objetivoId?: string;
}

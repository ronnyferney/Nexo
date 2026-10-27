/**
 * Modelos de los parámetros de ejecución del empleado digital (E8): estación virtual (estación de trabajo donde
 * «opera» el agente) y parámetros de ejecución (salida a internet y JSON extensible). Espejan el contrato del backend
 * (`/estaciones-virtuales` y `/execution-params/:agentId`). NUNCA incluyen credenciales: `proveedor` es solo etiqueta.
 */

/** Estados del ciclo de vida de una estación virtual. Coincide con el enum `EstadoEstacion` del backend. */
export const ESTADOS_ESTACION = ['ACTIVA', 'SUSPENDIDA', 'RETIRADA'] as const;
export type EstadoEstacion = (typeof ESTADOS_ESTACION)[number];

/** Estación virtual: recurso del workspace (máquina real o lógica) asignable a un empleado digital. */
export interface EstacionVirtual {
  id: string;
  workspaceId: string;
  nombre: string;
  descripcion: string | null;
  estado: EstadoEstacion;
  /** Etiqueta NO secreta del proveedor de la máquina ("interna" | "azure" | "aws" …). */
  proveedor: string | null;
  /** Agentes que la tienen asignada (lo calcula el backend). */
  agentesCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Alta de una estación virtual (solo ADMIN+ en el backend). */
export interface EstacionVirtualInput {
  nombre: string;
  descripcion?: string;
  proveedor?: string;
}

/** Edición de una estación virtual; el `estado` incluye la baja lógica a `RETIRADA`. */
export interface EstacionVirtualUpdate extends Partial<EstacionVirtualInput> {
  estado?: EstadoEstacion;
}

/** Vista de los parámetros de ejecución de un agente. */
export interface ParametrosEjecucion {
  agentId: string;
  estacionVirtualId: string | null;
  /**
   * Gate de navegación/fetch web general: `false` = sin navegación web. Es un gate ADICIONAL; cuando habilita, la
   * salida sigue pasando por el control de seguridad del servidor. Aplica con o sin estación asignada.
   */
  navegacionWeb: boolean;
  /**
   * Gate de conexión a conectores/sistemas de negocio (REST/SOAP/GraphQL/MCP): `false` = sin acceso a sistemas. Es un
   * gate ADICIONAL; cuando habilita, la salida sigue pasando por el control de seguridad. Aplica con o sin estación.
   */
  sistemasAutorizados: boolean;
  /**
   * Gate legado de salida a internet (PUENTE/espejo de las dos categorías). Se conserva por compatibilidad; la UI usa
   * `navegacionWeb` y `sistemasAutorizados`.
   */
  salidaInternet: boolean;
  /** Parámetros extensibles (p. ej. horario de operación, límites). */
  parametrosEjecucion: Record<string, unknown>;
}

/**
 * Cambio de los parámetros de ejecución (EDITOR+ en el backend). Solo se actualiza lo presente; `estacionVirtualId`
 * `null` desasigna la estación y `undefined` la deja igual.
 */
export interface SetParametrosEjecucion {
  estacionVirtualId?: string | null;
  /** Gate de navegación/fetch web general. */
  navegacionWeb?: boolean;
  /** Gate de conexión a conectores/sistemas de negocio (REST/SOAP/GraphQL/MCP). */
  sistemasAutorizados?: boolean;
  /** Gate legado de salida a internet (PUENTE/espejo). Opcional; preferir las dos categorías. */
  salidaInternet?: boolean;
  parametrosEjecucion?: Record<string, unknown>;
}

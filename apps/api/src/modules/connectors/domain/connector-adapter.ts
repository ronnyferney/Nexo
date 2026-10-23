import type { ConnectorType } from '@prisma/client';
import type {
  ConnectorRuntime,
  DiscoveredOperation,
  InvocationResult,
  OperationRuntime,
  TestResult,
} from './connector.types';

/**
 * Puerto (arquitectura hexagonal) que implementa cada protocolo.
 * Agregar un protocolo nuevo = crear un adaptador y registrarlo en ConnectorsModule.
 */
export interface ConnectorAdapter {
  readonly type: ConnectorType;
  invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult>;
  test(connector: ConnectorRuntime): Promise<TestResult>;
  discover?(connector: ConnectorRuntime, options?: DiscoverOptions): Promise<DiscoveredOperation[]>;
  /** Esquema de datos (tablas, vistas y columnas); solo conectores de base de datos. */
  describeSchema?(connector: ConnectorRuntime): Promise<{ tables: SchemaTableInfo[] }>;
}

/** Opciones de descubrimiento (DATABASE: tablas para las que se sugieren operaciones). */
export interface DiscoverOptions {
  tables?: string[];
}

export interface SchemaTableInfo {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: { name: string; type: string; nullable: boolean }[];
}

export const CONNECTOR_ADAPTERS = Symbol('CONNECTOR_ADAPTERS');

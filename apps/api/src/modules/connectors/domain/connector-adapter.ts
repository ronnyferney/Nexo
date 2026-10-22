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
  discover?(connector: ConnectorRuntime): Promise<DiscoveredOperation[]>;
}

export const CONNECTOR_ADAPTERS = Symbol('CONNECTOR_ADAPTERS');

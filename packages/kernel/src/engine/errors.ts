import type { KernelLifecycleState } from './state.js';

export class LifecycleStateError extends Error {
  public readonly code = 'INVALID_LIFECYCLE_STATE' as const;

  public readonly operation: string;

  public readonly currentState: KernelLifecycleState | undefined;

  public readonly expectedState: KernelLifecycleState | undefined;

  constructor(
    operation: string,
    currentState?: KernelLifecycleState,
    expectedState?: KernelLifecycleState,
  ) {
    super(LifecycleStateError.formatMessage(operation, currentState, expectedState));
    this.name = 'LifecycleStateError';
    this.operation = operation;
    this.currentState = currentState;
    this.expectedState = expectedState;
  }

  private static formatMessage(
    operation: string,
    currentState: KernelLifecycleState | undefined,
    expectedState: KernelLifecycleState | undefined,
  ): string {
    if (currentState === undefined) {
      return `Operation "${operation}" is not permitted in the current kernel lifecycle state`;
    }
    if (expectedState === undefined) {
      return `Operation "${operation}" is not permitted while the kernel is ${currentState}`;
    }
    return `Operation "${operation}" requires kernel state ${expectedState} but the kernel is ${currentState}`;
  }
}

export class CircularDependencyError extends Error {
  public readonly code = 'CIRCULAR_DEPENDENCY' as const;

  public readonly cyclePath: readonly string[];

  constructor(cyclePath: readonly string[]) {
    super(`Circular dependency detected: ${cyclePath.join(' -> ')}`);
    this.name = 'CircularDependencyError';
    this.cyclePath = [...cyclePath];
  }
}

export class MissingDependencyError extends Error {
  public readonly code = 'MISSING_DEPENDENCY' as const;

  public readonly missingTokenId: string;

  public readonly dependentTokenId: string;

  constructor(missingTokenId: string, dependentTokenId: string) {
    super(`Service "${dependentTokenId}" depends on unregistered service "${missingTokenId}"`);
    this.name = 'MissingDependencyError';
    this.missingTokenId = missingTokenId;
    this.dependentTokenId = dependentTokenId;
  }
}

export class ServiceNotFoundError extends Error {
  public readonly code = 'SERVICE_NOT_FOUND' as const;

  public readonly tokenId: string;

  constructor(tokenId: string) {
    super(`Service "${tokenId}" is not registered`);
    this.name = 'ServiceNotFoundError';
    this.tokenId = tokenId;
  }
}

export {
  AccessDeniedError,
  BlacklistedAccessViolationError,
  AllowlistViolationError,
} from '../contracts/policy.js';

export * from './src/contracts/index.js';
export * from './src/bootstrap/index.js';

// Hardcore services shipped inside the kernel package.
export * from './services/IdentityRegistry/index.js';
export * from './services/ExposedApiRegistry/index.js';

export { ServiceContainer } from './src/engine/ServiceContainer.js';
export { OperationRegistry } from './src/engine/OperationRegistry.js';
export { ExecutionPipeline } from './src/engine/ExecutionPipeline.js';
export { BrudKernel } from './src/engine/BrudKernel.js';

export { KernelRegistry } from './src/engine/KernelRegistry.js';
export { KernelAccessBroker } from './src/engine/KernelAccessBroker.js';
export type { KernelStateChecker } from './src/engine/KernelAccessBroker.js';
export { topologicalSort } from './src/engine/dag.js';

export {
  LifecycleStateError,
  CircularDependencyError,
  MissingDependencyError,
  ServiceNotFoundError,
} from './src/engine/errors.js';
export type { KernelLifecycleState } from './src/engine/state.js';
export * from './contracts/index.js';
export * from './bootstrap/index.js';
export * from '../drivers/index.js';
export * from '../services/BrudFileSystem/index.js';
export * from '../services/UniversalHistory/index.js';
export * from '../services/PluginManager/index.js';
export * from '../services/SettingsService/index.js';
export * from '../services/WorkspaceService/index.js';

// Phase 3 filesystem surface: canonical token, contract, scoped-driver
// durability capability, and the mutation journal Phase 4 binds to.
export { FileSystemToken } from '../services/BrudFileSystem/descriptor/tokens.js';
export type { IBrudFileSystem } from '../services/BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
export type { WorkspaceAuthority } from '../services/BrudFileSystem/orchestrator/BrudFileSystem.js';
export type { IDurableStorageDriver } from '../services/BrudFileSystem/operations/shared/durability.js';
export {
  FileMutationJournal,
  createFileMutationJournal,
} from '../services/BrudFileSystem/events/FileMutationJournal.js';
export type {
  FileMutationCommitStatus,
  FileMutationErrorSink,
  FileMutationEvent,
  FileMutationListener,
  FileMutationOperation,
  FileMutationPhase,
  FileMutationState,
  IFileMutationJournal,
} from '../services/BrudFileSystem/events/types.js';

export { ServiceContainer } from './engine/ServiceContainer.js';
export { OperationRegistry } from './engine/OperationRegistry.js';
export { ExecutionPipeline } from './engine/ExecutionPipeline.js';
export { BrudKernel } from './engine/BrudKernel.js';

export { KernelRegistry } from './engine/KernelRegistry.js';
export { KernelAccessBroker } from './engine/KernelAccessBroker.js';
export type { KernelStateChecker } from './engine/KernelAccessBroker.js';
export { topologicalSort } from './engine/dag.js';

export {
  LifecycleStateError,
  CircularDependencyError,
  MissingDependencyError,
  ServiceNotFoundError,
} from './engine/errors.js';
export type { KernelLifecycleState } from './engine/state.js';

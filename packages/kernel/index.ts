export * from './src/contracts/index.js';
export * from './src/bootstrap/index.js';
export * from './drivers/index.js';
export * from './services/ActionManager/index.js';
export * from './services/BrandRegistry/index.js';
export * from './services/BrudFileSystem/index.js';
export * from './services/BrudTools/index.js';
export * from './services/ExposedApiRegistry/index.js';
export * from './services/IdentityRegistry/index.js';
export * from './services/Parser/index.js';
export * from './services/Router/index.js';
export * from './services/UniversalHistory/index.js';
export * from './services/PluginManager/index.js';
export * from './services/SettingsService/index.js';
export * from './services/TerminalService/index.js';
export * from './services/UtilityService/index.js';
export * from './services/ValidationService/index.js';

// Path semantics are owned by the validation engine and re-exported under the
// pre-Phase-3 names. The workspace registry keeps only its root-routing
// helpers, so these three names resolve to one implementation.
export {
  assertSafeRelativePath,
  defaultPathFlavor,
  isContainedInRoot,
  pathApiFor,
} from './services/ValidationService/engine/pathLexicon.js';
export * from './services/WorkspaceService/index.js';

// Phase 3 filesystem surface: canonical token, contract, scoped-driver
// durability capability, and the mutation journal Phase 4 binds to.
export { FileSystemToken } from './services/BrudFileSystem/descriptor/tokens.js';
export type { IBrudFileSystem } from './services/BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
export type { WorkspaceAuthority } from './services/BrudFileSystem/orchestrator/BrudFileSystem.js';
export type { IDurableStorageDriver } from './services/BrudFileSystem/operations/shared/durability.js';
export {
  FileMutationJournal,
  createFileMutationJournal,
} from './services/BrudFileSystem/events/FileMutationJournal.js';
export type {
  FileMutationCommitStatus,
  FileMutationErrorSink,
  FileMutationEvent,
  FileMutationListener,
  FileMutationOperation,
  FileMutationPhase,
  FileMutationState,
  IFileMutationJournal,
} from './services/BrudFileSystem/events/types.js';

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
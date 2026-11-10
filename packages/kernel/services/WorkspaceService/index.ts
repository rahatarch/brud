export * from './contracts/IWorkspaceService.js';
export * from './contracts/errors.js';
export * from './model/canonicalization.js';
export * from './model/pathRules.js';
export * from './ports/StorageDriverPathPort.js';
export * from './orchestrator/WorkspaceService.js';
export * from './descriptor/tokens.js';
export * from './descriptor/descriptor.js';

// Temporary path bridge (rollout plan §3.3). Nothing in the kernel imports
// this module; it is exported for the host adapters and the path bridge only
// and disappears in Phase 11.
export * from './bridge/WorkspacePathBridge.js';

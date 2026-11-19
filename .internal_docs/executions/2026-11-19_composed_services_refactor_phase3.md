---
artifact: execution
topic: composed_services_refactor_phase3
date: 2026-11-19
stage_status: passed
supersedes: null
evidence: []
---

# Execution: Composed Services Refactor, Phase 3 (Validation, Workspace and BrudFileSystem cluster)

Plan: `plans/2026-11-19_composed_services_refactor_phase3.md`.

## What changed

### ValidationService
- `descriptor/ValidationDescriptor.ts` now uses `defineParticipant`.
- **Exposure:** `brud.validation@1`. A caller holding `validation:read` gets the instance; any other caller gets `null`.
- **Capabilities requested:** `settings:read` and `workspace:read`.
- **Calls to other services:** the two `broker.requestAccess(kernel, SettingsToken | WorkspaceToken)` calls became `ctx.resolve('brud.settings')` and `ctx.resolve('brud.workspace')`.
- **Boot pin:**
  - `resolve` only works once the service is RUNNING, so pinning the boot policy moved to the participant's `onRunning`.
  - The module-level `pinBootPolicies` hook still exists, but it does nothing before RUNNING.
  - The pin runs only once.
  - Until it runs, the service enforces the strict placeholder policy, as it did before.
- **Kept on the descriptor:** `dependencies: [SettingsToken]` (boot order) and `accessPolicy`.
- **Added:** `contracts/exposure.ts`, exported from `index.ts`.

### WorkspaceService
- `descriptor/descriptor.ts` now uses `defineParticipant`.
- **Exposure:** `brud.workspace@1`, granted to callers holding `workspace:read`.
- **Boot context:** captured with the same factory wrapper as Phase 2, for the namespaced workspace-root option.
- **New `ports/NodePathPort.ts`:** the default path port is now built on `node:fs/promises`, owned by WorkspaceService.
  - It replaces `new NodeStorageDriver()`.
  - An injected `driver` still goes through `createStorageDriverPathPort`.
- **Added:** `contracts/exposure.ts`, exported from `index.ts`.

### BrudFileSystem
- `descriptor/descriptor.ts` now uses `defineParticipant`.
- **Exposure:** `brud.filesystem@1`. The SDK only accepts lower-case dotted names, so `brud.fileSystem` was rejected.
- **One handle replaces the two `lastProjectionWins` registrations:**
  - `fs:write` gives the full instance, or the authorized-scope projection when the caller's kernel identity appears in `authorizedWriteScopesByCaller`.
  - `fs:read` gives a `ReadOnlyFacade`.
  - Any other caller gets `null`.
- **Token-level `project`:** kept for hosts that still take the token directly. It covers partition prefixes and the read-only views for userland and kernel callers.
- **Added:** `contracts/exposure.ts`, exported from `contracts/index.ts`.

## How the cycles were broken

- **Validation → Workspace:** the runtime import of `WorkspaceService/descriptor/tokens` was removed. Validation now reaches Workspace through `ctx.resolve('brud.workspace')`. This closed the Validation ↔ Workspace cycle.
- **Workspace → BrudFileSystem:** the runtime import of `BrudFileSystem/drivers` (`NodeStorageDriver`) was replaced by WorkspaceService's own `createNodePathPort()`. This closed the Workspace ↔ BrudFileSystem cycle.
- **Validation → BrudFileSystem:** this edge is type-only (`IStorageDriver`), so it was never a runtime cycle.
- **Runtime import graph of the cluster now (source files only):** BrudFileSystem → Workspace → Validation (`contracts/errors`), and BrudFileSystem → Validation. The graph has no cycles.
- **Left in place, pending D1:**
  - BrudFileSystem still builds its own Workspace and Validation instances when it is created from a root path.
  - It also reuses `LexicalPathEngine`, `pathRules`, error classes and `DEFAULT_VALIDATION_POLICY`.
  - These are one-way library reuse, not service-to-service calls.
  - Moving them to `resolve` or a shared package needs D1, and the BrudFileSystem constructor would have to stop needing its authorities before RUNNING.

## D4 and D7

- **D4:** still pending. The mutation-journal push is unchanged (parent Step 10).
- **D7 (packaging):** belongs to parent Step 11 and was not changed here.

## Results

- **Services typecheck:** **20 errors**, down from 31. Validation, Workspace and BrudFileSystem each have 0. The remaining errors: ActionManager 4, PluginManager 5, TerminalService 3, UniversalHistory 8.
- **Legacy-pattern search** (`withExposedApis|CORE_API_NAME|lastProjectionWins|requestAccess`) in the three services' source files: 0 matches.
- **Tests:**

  | Service | Pass | Fail |
  |---|---|---|
  | ValidationService | 247 | 1 file |
  | WorkspaceService | 88 | 1 test + 1 file |
  | BrudFileSystem | 174 | 1 file |

  - All the remaining failures come from `createStandardKernel`, which `@brud/kernel` no longer exports.
  - The files fail when they load, whatever this change does: `validationService.test.ts`, `WorkspaceService.bootstrap.test.ts`, `bootstrapIntegration.test.ts`, plus one case in `WorkspaceService/descriptor/descriptor.test.ts`.
  - They stay failing until they are rewritten against `bootKernel` / `bootTestKernel`, which is the parent plan's step-0 composed-services boot helper.
  - No test was weakened or skipped.

## Files beyond the plan's starting map

- **New:**
  - `WorkspaceService/ports/NodePathPort.ts`: breaks the Workspace → BrudFileSystem cycle.
  - `{Validation,Workspace,BrudFileSystem}/contracts/exposure.ts`: exposure contracts.
- **`BrudFileSystem/contracts/index.ts` and `{Validation,Workspace}Service/index.ts`:** export the new exposure contracts.
- **`WorkspaceService/descriptor/descriptor.test.ts`:** registers `createExposedApiRegistryDescriptor()` in its bare-kernel tests, as in Phase 2, because participants fetch the registry when they reach RUNNING.

## Open items

- **Validation boot pin:** the move to `onRunning` is not yet covered by a real-kernel test. That test comes with the composed-services boot helper.
- **SDK gaps:**
  - `create` does not receive the `ServiceContext`; three services now share the workaround.
  - Exposure names must be lower-case.

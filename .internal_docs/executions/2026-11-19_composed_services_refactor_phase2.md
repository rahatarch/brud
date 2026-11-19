---
artifact: execution
topic: composed_services_refactor_phase2
date: 2026-11-19
stage_status: passed
supersedes: null
evidence: []
---

# Execution: Composed Services Refactor, Phase 2 (SettingsService)

Parent plan: `plans/2026-11-19_composed_services_refactor.md`, Step 3. Reference template: `packages/services/BrudTools/`.

## Dual-exposure pattern

SettingsService still ships two participants (the `serviceModule.ts` and `settingsReader.ts` entry points), and each now declares one exposure with `defineParticipant`.

- **`brud.settings@1`**, owned by participant `brud.core.settings`:
  - The exposure is gated by capability using `byCapability`.
  - `settings:read` gives `getSnapshot` and `onChange`.
  - `settings:write` gives those two plus `update` and `reload`.
  - A caller with neither capability gets `null`. That is the SDK's `byCapability` behaviour, the same as BrudTools.
  - The token-level `accessPolicy` allow-list (kernel, daemon, desktop) is kept, for hosts that still take the token directly.
- **`brud.settings.reader@1`**, owned by participant `brud.core.settings.reader`:
  - The exposure is open to every caller and serves `getSnapshot` and `onChange`.
  - The participant requests `settings:read` and reads through `ctx.resolve('brud.settings')` on every call.
  - Until that resolves, it serves `DEFAULT_SETTINGS` and an unsubscribe function that does nothing.
  - It keeps `dependencies: [SettingsToken]`, for boot order only.
- **New contract file `contracts/exposure.ts`.** It holds:
  - the literal exposure names;
  - `SETTINGS_READ_CAPABILITY` and `SETTINGS_WRITE_CAPABILITY`;
  - the `ISettingsReaderApi` and `ISettingsApi` types, with the mutators optional.

  The settings reader name, `brud.settings.reader`, matches the one BrudTools already resolves.
- **Behaviour change.** Before, a projection based on caller tier gave userland callers only the reader. Now access depends on capabilities (Layer 2). Open read access is the reader exposure.
- **Removed.** `withExposedApis`, `CORE_API_NAME.settings` and `CORE_API_NAME.settingsReader`, and the old `project` hook.
- **requestAccess to ctx.resolve.** The single source call, the reader's `broker.requestAccess(kernel, SettingsToken)`, is now `ctx.resolve('brud.settings')`.

### SDK gap, handled locally

The SDK's `defineParticipant` calls the factory with no arguments, so `create` never receives the boot `ServiceContext`. The settings participant needs it for the `settings.root` context field. `createSettingsDescriptor` therefore wraps the SDK factory to capture the context before calling it. It also puts back the original `SettingsToken` and `SettingsReaderToken` objects, because the SDK creates fresh tokens with the same ids, and the tests and other services compare token identity. Neither the kernel nor the SDK was changed. Proposed follow-up: the SDK should pass the `ServiceContext` to `create`.

## onChange and Decision D4

- `.internal_docs/decisions/` contains no record of D4 for composed services. D4 ("private push mechanisms → events") is still pending in the parent plan, §4. The only "D4" match in that folder, in `2026-11-01_multi_process_undo_semantics.md`, is unrelated.
- The task said to fall back to the brud event pattern used in BrudTools. BrudTools declares no events (its manifest has `events: []`), so there is no event pattern there to copy.
- What was implemented: `onChange` stays a method on the API, served through both exposures, and the reader forwards it through `resolve`. Moving it to the events primitive stays in parent-plan Step 10, pending D4.

## Results

- **Services typecheck** (`tsc -p packages/services/tsconfig.json --noEmit`): **31 errors**, down from 35. SettingsService has **0**. The remaining errors: ActionManager 4, BrudFileSystem 5, PluginManager 5, TerminalService 3, UniversalHistory 8, ValidationService 3, WorkspaceService 3.
- **Kernel typecheck:** 0 errors.
- **Daemon typecheck:** 36 errors, the same as before. They are unresolved `@brud/service-*` modules and their knock-on errors, and none is new. `npm run typecheck` stops after the services step while services errors remain, so each package was checked on its own.
- **SettingsService tests** (`tsx --test`, all test files in the service): **90/90 pass**. That includes a new test that boots a real kernel through `bootTestKernel`.
- **Legacy-pattern search** in the source (`withExposedApis|CORE_API_NAME|lastProjectionWins|requestAccess`): 0 matches. `requestAccess` still appears in `descriptor.test.ts`, where tests take the token directly to check the kept `accessPolicy`.

## Files beyond the starting map

- **`contracts/exposure.ts` (new).** The exposure contract, following the BrudTools pattern.
- **`index.ts`.** Exports the exposure contract.
- **`descriptor/descriptor.test.ts`:**
  - It now registers `createExposedApiRegistryDescriptor()`, because participants fetch the registry when they reach the running state.
  - The boot-order check now asserts that settings boots before its reader, since the registry is now the first service.
  - It adds a check of the manifest exposures.
  - The live `onChange` check moved to the new test below. A bare `BrudKernel` has no identity registry, so `resolve` returns `null` there.
- **`__tests__/exposures.test.ts` (new).** It boots a real kernel with the hardcore services, both settings modules and two probe participants. It checks:
  - the reader surface;
  - that `brud.settings` gives `null` to a caller without capabilities;
  - the full surface for a `settings:write` caller;
  - that the reader sees a live `onChange` notification and the updated snapshot.

## Housekeeping

- During debugging, two scratch files ended up in the repo. Deletion is not permitted in this session, so both were moved to `_to_delete/` at the repo root for manual removal:
  - `zz_dbg.ts` came from an accidental copy of an unrelated `/tmp/dbg.test.ts`;
  - `dbg_settings.mts` was a debugging probe.

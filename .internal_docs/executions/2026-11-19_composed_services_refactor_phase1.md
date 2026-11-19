---
artifact: execution
topic: composed_services_refactor_phase1
date: 2026-11-19
stage_status: passed
supersedes: null
evidence: []
---

# Execution — Composed Services Refactor, Phase 1 (BrandRegistry, UtilityService)

Plan: `.internal_docs/plans/2026-11-19_composed_services_refactor_phase1.md`. Template: `packages/services/BrudTools/`.

## What changed

### BrandRegistry
- Added `contracts/exposure.ts`: the exposure name `brud.brands` and the `IBrandRegistryApi` type (equal to `IBrandRegistry`). It is re-exported from `contracts/index.ts`.
- `descriptor/descriptor.ts` now builds the descriptor with `defineParticipant`. It declares one exposure, `brud.brands@1` with scope `runtime`, whose handle returns the instance. The token, the tier (`core`), the empty dependency list and the `onConstruct` hook are all kept, so `serviceModule.ts` still publishes the instance to the shared slot that PluginManager reads through `requireBrandRegistry`.
- `index.ts` uses the BrudTools export layout: `export *` from contracts, descriptor and orchestrator. The public names are the same as before, plus the new exposure items.
- `CORE_API_NAME`: there was none before and there is none now (checked with grep).

### UtilityService
- Added `contracts/exposure.ts`: the exposure name `brud.utilities` and the `IUtilityApi` type. It is exported from `index.ts`.
- `descriptor/UtilityServiceDescriptor.ts`: the `withExposedApis` / `registry.registerApi(CORE_API_NAME.utilities, …)` call is replaced by `defineParticipant`, which declares one public, zero-authority exposure, `brud.utilities@1`. The legacy `UTILITY_PUBLIC_API_CAPABILITY = '*'` marker is removed; nothing referenced it. The participant requests no capabilities and resolves nothing (D-20), so the source has no `ctx.resolve` calls to add.
- `__tests__/utility-service.test.ts`: this was the only place with `requestAccess` and with the `PluginManager` and `BrudFileSystem` imports flagged in the audit. It booted `createStandardKernel` with a plugin, which made a leaf service's tests depend on PluginManager, BrudFileSystem and the whole standard composition. The rewrite asserts the descriptor's manifest, meaning its token, tier, empty dependencies and exposures list, which must be exactly `[{ name: 'brud.utilities', version: 1, scope: 'runtime' }]`. It also runs the same TS/JS/Python resolution assertions directly against the API that the exposure serves, and keeps the standalone-instance case.

## Rationale

The v1 kernel removed the imperative registration API. Services must declare their exposures in the manifest, and they call one another through `resolve` at call time instead of `requestAccess` or importing each other's code. `defineParticipant` produces the manifest and the bindings from one definition, as BrudTools does, so the two leaves now follow the same pattern. Removing the test's reliance on PluginManager breaks the backwards dependency from a leaf to the top-level service.

## Verification

- `tsc -p packages/services/tsconfig.json --noEmit`: **35 errors** (from 38), and 0 in BrandRegistry and UtilityService. The remaining errors: ActionManager 4, BrudFileSystem 5, PluginManager 5, SettingsService 4, TerminalService 3, UniversalHistory 8, ValidationService 3, WorkspaceService 3.
- Kernel and protocol typecheck: 0 errors each.
- Daemon typecheck: 36 errors (31 × TS2307 "cannot find module `@brud/service-*`", plus 1 TS2339 and 4 TS7006 that follow from them). These come from the unbuilt services package, are not new, and none points to the Phase 1 changes. They clear once the services package builds (end of the parent plan). Note: `npm run typecheck` chains its packages with `&&`, so it stops after the services step while services errors remain. Each package was therefore checked on its own.
- Tests: `tsx --test` on BrandRegistry and UtilityService: **13/13 pass**, including `utility-purity.test.ts`.
- Legacy-pattern search (`withExposedApis|CORE_API_NAME|lastProjectionWins|requestAccess`, plus cross-service imports) in both trees: 0 matches.

## Files changed beyond the plan's starting map

- `BrandRegistry/contracts/index.ts`: re-exports the new exposure file, which plan step 1.1 needs.
- `UtilityService/index.ts`: exports the new exposure file.
- `UtilityService/__tests__/utility-service.test.ts`: rewritten as described above. The plan expected only a scan. Coverage lost: the check that `getUtilities()` is available on a plugin context. That is PluginManager behaviour and moves to parent-plan Step 9 (PluginManager, D5).

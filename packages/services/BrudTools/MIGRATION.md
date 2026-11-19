# BrudTools on the v1 kernel — the migration template

BrudTools was migrated touching only this directory, using only `@brud/kernel`'s
public API. The steps below are the template for every composed service (and
what a third-party participant does from scratch).

1. **Declare, don't register.** `manifest.exposures: [{ name: 'brud.tools', version: 1, scope: 'runtime' }]`
   replaces `withExposedApis` / `CORE_API_NAME` / `lastProjectionWins` (removed in 51eb6a1).
2. **One projection, shaped by the real caller.** `withExposureBindings(service, { 'brud.tools@1': { projection } })`.
   Several capability-gated registrations of one name become one projection
   (`descriptor/toolsExposure.ts`): `tools:register` → `registerTool`;
   `tools:execute` → `executeTool`, `validateTool`; both → read; neither → `null`.
   (Layer 1 `policy.capabilities` is AND-only, so an OR gate lives in Layer 2.)
3. **Identity comes from the kernel.** Owner, officialness, permissions and
   origin are taken from the caller view, never from arguments. The handle's
   `registerTool(options)` and `executeTool(name, input, { workspaceRoot, signal? })`
   no longer accept `pluginId`, `isOfficial`, `callerId` or `permissions`.
4. **Reach others by resolve, as yourself.** In `onRunning`, request the
   registry with your own token; resolve other givers' exposures by name
   (`brud.settings.reader`). Never impersonate the kernel; no `requestAccess`
   to another service's token.
5. **Own your constants and types.** `BRUD_KIND_TOOL`, `IToolDisposable`,
   `IToolsLogger`, `deepFreeze` live here. No runtime import of another
   service's source; the one library dependency (the JSON Schema engine) is
   isolated in `schema/jsonSchema.ts`.
6. **Test like a third party.** `__tests__/support/kernelHarness.ts` boots the
   real kernel (seven hardcores + this service + test participants) through
   `bootKernel` only; `__tests__/exposure.test.ts` covers surfaces, identity,
   gates, the settings resolve, fail-open, and a caged caller via `brud.call`.

Expects from the Settings refactor: an exposure `brud.settings.reader@1` whose
handle has `getSnapshot(): { toolAllowList?: Record<string, boolean> }`.

[**BrudOS Kernel API**](../README.md)

***

[BrudOS Kernel API](../README.md) / services/WasmCage

# WASM Cage (hardcore 5)

## Classes

### CagedGuestError

A caged guest failed: a trap, an exhausted budget, or a refused response.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new CagedGuestError(
   message, 
   guestCode?, 
   options?
): CagedGuestError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `guestCode?` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`CagedGuestError`](#cagedguesterror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
readonly code: "WASM_CAGE_GUEST_FAILED";
```

##### guestCode

```ts
readonly guestCode: string | undefined;
```

The guest-reported error code, when the guest reported one.

***

### CageNativeError

The cage's native binary is unavailable or failed its digest check.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new CageNativeError(code, message): CageNativeError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | [`CageNativeErrorCode`](#cagenativeerrorcode-1) |
| `message` | `string` |

###### Returns

[`CageNativeError`](#cagenativeerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
readonly code: CageNativeErrorCode;
```

***

### ParticipantPackageError

A participant package is malformed or its module failed its digest check.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new ParticipantPackageError(code, message): ParticipantPackageError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `"PARTICIPANT_PACKAGE_INVALID"` \| `"PARTICIPANT_PACKAGE_TAMPERED"` |
| `message` | `string` |

###### Returns

[`ParticipantPackageError`](#participantpackageerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
readonly code: "PARTICIPANT_PACKAGE_INVALID" | "PARTICIPANT_PACKAGE_TAMPERED";
```

## Interfaces

### CagedParticipantLimits

Resource limits for one caged participant.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-deadlinems"></a> `deadlineMs?` | `readonly` | `number` | Wall-clock deadline per call into the guest, in milliseconds (default 30 s). |
| <a id="property-fuel"></a> `fuel` | `readonly` | `number` | Fuel per call: the call's deadline. |
| <a id="property-maxmemorybytes"></a> `maxMemoryBytes` | `readonly` | `number` | Maximum linear-memory size in bytes. |

***

### CagedParticipantOptions

Options for [createCagedParticipant](#createcagedparticipant).

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-limits"></a> `limits?` | `readonly` | [`CagedParticipantLimits`](#cagedparticipantlimits) | Resource limits. |
| <a id="property-manifest"></a> `manifest` | `readonly` | [`ParticipantManifest`](../src/contracts.md#participantmanifest) | The participant's manifest, declared exactly as a native participant's. |
| <a id="property-token"></a> `token` | `readonly` | `string` | The participant's service token id. |
| <a id="property-wasm"></a> `wasm` | `readonly` | `Uint8Array` | The guest module: WASM binary or WAT text bytes. |

***

### IWasmCage

Public interface the cage promises to the kernel.

#### Methods

##### bindAuthority()

```ts
bindAuthority(value): void;
```

Binds the kernel's call authority.

Called once from the cage's hardcore boot hook, with the authority the
kernel hands that hook. Before it is called, `resolve` returns `null`
rather than running without a chain.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | [`KernelCallAuthority`](../src/contracts.md#kernelcallauthority) | The kernel's call authority. |

###### Returns

`void`

##### resolve()

```ts
resolve<T>(
   participantIdentity, 
   name, 
   options?
): T | null;
```

Runs one caged participant's `resolve` against the exposed-API registry.

The cage starts a `runtime`-origin chain with the caged participant's
recorded caller (W-06), so the frame carries the participant's
kernel-issued identity and its parent relation (W-07). The cage does not
decide policy: the registry evaluates the giver's Layer 1 policy. The cage
is the door, and `resolve` is the only method on its surface (W-02, W-09).

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t"></a> `T` | `unknown` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `participantIdentity` | `string` | The caged participant's kernel-issued token. |
| `name` | `string` | The exposure to resolve. |
| `options?` | \{ `expectedOwner?`: `string`; `version?`: `string` \| `number`; \} | Version and expected owner identity. |
| `options.expectedOwner?` | `string` | - |
| `options.version?` | `string` \| `number` | - |

###### Returns

`T` \| `null`

The resolved handle, or `null`.

## Type Aliases

### CageNativeErrorCode

```ts
type CageNativeErrorCode = "WASM_CAGE_NATIVE_UNAVAILABLE" | "WASM_CAGE_NATIVE_TAMPERED";
```

Error codes of the native loader.

## Variables

### DEFAULT\_CAGED\_LIMITS

```ts
const DEFAULT_CAGED_LIMITS: CagedParticipantLimits;
```

Default caged-participant limits.

***

### PARTICIPANT\_PACKAGE\_FORMAT

```ts
const PARTICIPANT_PACKAGE_FORMAT: 1 = 1;
```

Participant packages: how a participant that is not declared official reaches
the kernel (W-01). The package is declarative data plus a WASM module; no
author JavaScript is loaded. `brud.participant.json`:

```json
{ "format": 1, "id": "acme.notes", "manifest": { … },
  "cage": { "module": "participant.wasm", "sha256": "<hex>", "limits": { "fuel": …, "maxMemoryBytes": …, "deadlineMs": … } },
  "native": "native/index.js" }
```

`native` is optional and used only when the composition declares the entry
official; the kernel's loader reads it, never this module.

***

### WASM\_CAGE\_CONTRACT\_METHODS

```ts
const WASM_CAGE_CONTRACT_METHODS: readonly ["resolve"];
```

Methods declared for the cage's interface.

The cage's only participant-facing surface is the exposed-API registry's
`resolve` (design record W-02, W-09). The cage is not a second giver; it is
the mechanism that carries a caged participant's call to the registry.

***

### WASM\_CAGE\_CONTRACT\_VERSION

```ts
const WASM_CAGE_CONTRACT_VERSION: "1.0.0" = '1.0.0';
```

Contract version declared for the cage's interface.

***

### WASM\_CAGE\_SERVICE\_TIER

```ts
const WASM_CAGE_SERVICE_TIER: ServiceTier = 'core';
```

Tier assigned to the cage's descriptor.

***

### WasmCageToken

```ts
const WasmCageToken: ServiceToken<IWasmCage>;
```

Token identifying the cage.

## Functions

### createCagedParticipant()

```ts
function createCagedParticipant(options): ServiceDescriptor<object>;
```

Builds the descriptor of a caged participant: a participant whose code runs
inside the WASM cage and which may be a giver (exposures and interception
points) and an interceptor, exactly like a native participant.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | [`CagedParticipantOptions`](#cagedparticipantoptions) | Token, manifest, guest module, and limits. |

#### Returns

[`ServiceDescriptor`](../src/contracts.md#servicedescriptor)\<`object`\>

The participant's descriptor.

***

### createWasmCageDescriptor()

```ts
function createWasmCageDescriptor(): ServiceDescriptor<IWasmCage>;
```

#### Returns

[`ServiceDescriptor`](../src/contracts.md#servicedescriptor)\<[`IWasmCage`](#iwasmcage)\>

***

### loadParticipantPackage()

```ts
function loadParticipantPackage(manifestPath): Promise<{
  createService(): ServiceDescriptor<object>;
}>;
```

Loads a participant package into the cage: validates the package, checks
the module's SHA-256 against the package, and returns a service module whose
descriptor runs the participant caged.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `manifestPath` | `string` | Absolute path of `brud.participant.json`. |

#### Returns

`Promise`\<\{
  `createService`(): [`ServiceDescriptor`](../src/contracts.md#servicedescriptor)\<`object`\>;
\}\>

A service module (`createService`).

#### Throws

For a malformed package or a digest mismatch.

***

### nativePlatformKey()

```ts
function nativePlatformKey(): string;
```

The running platform's key, e.g. `linux-x64-gnu`, `darwin-arm64`, `win32-x64-msvc`.

#### Returns

`string`

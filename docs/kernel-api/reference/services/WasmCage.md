[**BrudOS Kernel API**](../README.md)

***

[BrudOS Kernel API](../README.md) / services/WasmCage

# WASM Cage (hardcore 5)

## Interfaces

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

## Variables

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

### createWasmCageDescriptor()

```ts
function createWasmCageDescriptor(): ServiceDescriptor<IWasmCage>;
```

#### Returns

[`ServiceDescriptor`](../src/contracts.md#servicedescriptor)\<[`IWasmCage`](#iwasmcage)\>

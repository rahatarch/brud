[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/Router/contracts

# Router (hardcore 4)

## Classes

### RouterDisposedError

Raised when routing is attempted after disposal.

#### Extends

- [`RouterError`](#abstract-routererror)

#### Constructors

##### Constructor

```ts
new RouterDisposedError(): RouterDisposedError;
```

###### Returns

[`RouterDisposedError`](#routerdisposederror)

###### Overrides

[`RouterError`](#abstract-routererror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "ROUTER_DISPOSED";
```

Stable, machine-readable error code.

###### Overrides

[`RouterError`](#abstract-routererror).[`code`](#code-1)

***

### `abstract` RouterError

Base class for every Router domain failure.

#### Extends

- `Error`

#### Extended by

- [`RouterDisposedError`](#routerdisposederror)
- [`RouterInvalidKindError`](#routerinvalidkinderror)
- [`RouterKindCollisionError`](#routerkindcollisionerror)
- [`RouterRegistrationClosedError`](#routerregistrationclosederror)
- [`RouterUnknownServiceError`](#routerunknownserviceerror)

#### Constructors

##### Constructor

```ts
protected new RouterError(message, options?): RouterError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`RouterError`](#abstract-routererror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: RouterErrorCode;
```

Stable, machine-readable error code.

***

### RouterInvalidKindError

Raised when a registrant supplies a malformed kind token.

#### Extends

- [`RouterError`](#abstract-routererror)

#### Constructors

##### Constructor

```ts
new RouterInvalidKindError(kind): RouterInvalidKindError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `kind` | `string` | Rejected value. |

###### Returns

[`RouterInvalidKindError`](#routerinvalidkinderror)

###### Overrides

[`RouterError`](#abstract-routererror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "ROUTER_INVALID_KIND";
```

Stable, machine-readable error code.

###### Overrides

[`RouterError`](#abstract-routererror).[`code`](#code-1)

##### kind

```ts
readonly kind: string;
```

Rejected value.

***

### RouterKindCollisionError

Raised when two services claim the same kind.

#### Extends

- [`RouterError`](#abstract-routererror)

#### Constructors

##### Constructor

```ts
new RouterKindCollisionError(kind, existingTokenId): RouterKindCollisionError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `kind` | `string` | Contested kind. |
| `existingTokenId` | `string` | Token id that already owns the kind. |

###### Returns

[`RouterKindCollisionError`](#routerkindcollisionerror)

###### Overrides

[`RouterError`](#abstract-routererror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "ROUTER_KIND_COLLISION";
```

Stable, machine-readable error code.

###### Overrides

[`RouterError`](#abstract-routererror).[`code`](#code-1)

##### existingTokenId

```ts
readonly existingTokenId: string;
```

Token id that already owns the kind.

##### kind

```ts
readonly kind: string;
```

Contested kind.

***

### RouterRegistrationClosedError

Raised when a kind is claimed after the boot registration window closed.

#### Extends

- [`RouterError`](#abstract-routererror)

#### Constructors

##### Constructor

```ts
new RouterRegistrationClosedError(kind): RouterRegistrationClosedError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `kind` | `string` | Kind the late registrant attempted to claim. |

###### Returns

[`RouterRegistrationClosedError`](#routerregistrationclosederror)

###### Overrides

[`RouterError`](#abstract-routererror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "ROUTER_REGISTRATION_CLOSED";
```

Stable, machine-readable error code.

###### Overrides

[`RouterError`](#abstract-routererror).[`code`](#code-1)

##### kind

```ts
readonly kind: string;
```

Kind the late registrant attempted to claim.

***

### RouterUnknownServiceError

Raised when a registrant names a service the kernel does not own.

#### Extends

- [`RouterError`](#abstract-routererror)

#### Constructors

##### Constructor

```ts
new RouterUnknownServiceError(tokenId): RouterUnknownServiceError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `tokenId` | `string` | Token id that could not be resolved. |

###### Returns

[`RouterUnknownServiceError`](#routerunknownserviceerror)

###### Overrides

[`RouterError`](#abstract-routererror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "ROUTER_UNKNOWN_SERVICE";
```

Stable, machine-readable error code.

###### Overrides

[`RouterError`](#abstract-routererror).[`code`](#code-1)

##### tokenId

```ts
readonly tokenId: string;
```

Token id that could not be resolved.

## Interfaces

### BrudDispatchContext

Context handed to a kind owner's dispatch exposure for one operation.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-caller"></a> `caller` | `readonly` | `BrudDispatchCaller` | Kernel-derived caller of the route request. |
| <a id="property-dryrun"></a> `dryRun?` | `readonly` | `boolean` | Validate only; do not execute. |
| <a id="property-signal"></a> `signal?` | `readonly` | `AbortSignal` | Cancellation signal, when the transport supplied one. |
| <a id="property-workspaceroot"></a> `workspaceRoot` | `readonly` | `string` | Workspace root the operation runs against. |

***

### BrudRouteOptions

Options for one route request. Caller identity and capabilities are not
options: the Router takes them from the kernel call chain.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-dryrun-1"></a> `dryRun?` | `readonly` | `boolean` |
| <a id="property-maxoperations"></a> `maxOperations?` | `readonly` | `number` |
| <a id="property-signal-1"></a> `signal?` | `readonly` | `AbortSignal` |
| <a id="property-stoponfailure"></a> `stopOnFailure?` | `readonly` | `boolean` |
| <a id="property-workspaceroot-1"></a> `workspaceRoot?` | `readonly` | `string` |

***

### BrudRouteRegistration

Boot-time claim of a kind. The owner names one of its own exposures; the
Router resolves it per operation on the kernel call chain and calls
`dispatch`. No service token is involved.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-exposure"></a> `exposure` | `readonly` | `string` | Name of the owner's dispatch exposure (`name`, major `version`). |
| <a id="property-kind"></a> `kind` | `readonly` | `string` | - |
| <a id="property-version"></a> `version?` | `readonly` | `number` | - |

***

### BrudRouteResult

Result of parsing and routing one document.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-dispatched"></a> `dispatched` | `readonly` | `number` |
| <a id="property-failed"></a> `failed` | `readonly` | `number` |
| <a id="property-operations"></a> `operations` | `readonly` | readonly [`RoutedOperationOutcome`](#routedoperationoutcome)[] |
| <a id="property-parseerror"></a> `parseError?` | `readonly` | [`BrudParseFailure`](../Parser/contracts.md#brudparsefailure) |
| <a id="property-status"></a> `status` | `readonly` | [`RouteStatus`](#routestatus) |

***

### IRouterRegistrant

Implemented by a Level-1 service that wants to claim a kind at boot.

The standard composition calls the hook while the kernel is still BOOTING
and the access broker's lifecycle gate is suspended, before the router
seals its registration window.

#### Methods

##### registerWithRouter()

```ts
registerWithRouter(router): void;
```

Claims one or more kinds on the router.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `router` | [`IRouterService`](#irouterservice) | Router accepting boot-time registrations. |

###### Returns

`void`

***

### IRouterService

Level-1 Brud kind Router.

Accepts boot-time kind registrations from kernel services, resolves the
owning service through the kernel access broker with its `ServiceToken`, and
dispatches parsed operations. It never routes to a plugin directly.

#### Methods

##### closeRegistration()

```ts
closeRegistration(): void;
```

Seals the registration window. Idempotent.

###### Returns

`void`

##### dispatch()

```ts
dispatch(
   operations, 
   options?, 
   caller?
): Promise<BrudRouteResult>;
```

Routes an already-parsed operation list.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `operations` | readonly [`BrudOperation`](../Parser/contracts.md#brudoperation)[] | Operations emitted by the Parser. |
| `options?` | [`BrudRouteOptions`](#brudrouteoptions) | Caller context and routing bounds. |
| `caller?` | `BrudDispatchCaller` | - |

###### Returns

`Promise`\<[`BrudRouteResult`](#brudrouteresult)\>

##### isRegistrationOpen()

```ts
isRegistrationOpen(): boolean;
```

Whether new kinds may still be claimed.

###### Returns

`boolean`

##### register()

```ts
register(registration): void;
```

Claims a kind on behalf of a Level-1 service.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `registration` | [`BrudRouteRegistration`](#brudrouteregistration) |

###### Returns

`void`

###### Throws

RouterRegistrationClosedError when the boot window has closed.

###### Throws

RouterInvalidKindError when the kind token is malformed.

###### Throws

RouterKindCollisionError when another service already owns it.

###### Throws

RouterUnknownServiceError when the token is not registered.

##### registeredKinds()

```ts
registeredKinds(): readonly string[];
```

Kinds currently claimed, in registration order.

###### Returns

readonly `string`[]

##### route()

```ts
route(
   rawInput, 
   options?, 
   caller?
): Promise<BrudRouteResult>;
```

Parses a raw document with `brud.core.parser` and routes every operation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `rawInput` | `string` | Raw `[BRUD]` document. |
| `options?` | [`BrudRouteOptions`](#brudrouteoptions) | Caller context and routing bounds. |
| `caller?` | `BrudDispatchCaller` | - |

###### Returns

`Promise`\<[`BrudRouteResult`](#brudrouteresult)\>

***

### RoutedOperationOutcome

Outcome of routing one parsed operation.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `readonly` | `string` | Diagnostic message for routing-level failures. |
| <a id="property-kind-1"></a> `kind` | `readonly` | `string` | Shared kind token. |
| <a id="property-name"></a> `name` | `readonly` | `string` | Operation name written on the header. |
| <a id="property-operationindex"></a> `operationIndex` | `readonly` | `string` | Synthesized 1-based document index. |
| <a id="property-result"></a> `result?` | `readonly` | [`OperationResult`](../../src/contracts.md#operationresult)\<`unknown`\> | Target result, when a target ran. |
| <a id="property-sequence"></a> `sequence` | `readonly` | `number` | Zero-based document position. |
| <a id="property-status-1"></a> `status` | `readonly` | [`RoutedOperationStatus`](#routedoperationstatus) | Terminal status of this operation. |

## Type Aliases

### RoutedOperationStatus

```ts
type RoutedOperationStatus = "success" | "failed" | "skipped" | "aborted" | "kind_not_registered";
```

Terminal status of one routed operation.

***

### RouterErrorCode

```ts
type RouterErrorCode = 
  | "ROUTER_REGISTRATION_CLOSED"
  | "ROUTER_KIND_COLLISION"
  | "ROUTER_INVALID_KIND"
  | "ROUTER_UNKNOWN_SERVICE"
  | "ROUTER_DISPOSED";
```

Stable, machine-readable codes for Router failures.

***

### RouteStatus

```ts
type RouteStatus = "success" | "partial" | "failed" | "empty";
```

Aggregate status of a routed document.

## Variables

### ROUTER\_CALLER\_ID

```ts
const ROUTER_CALLER_ID: "brud.core.router";
```

Caller identity the Router uses when resolving a registered service.

Access policies that must accept Router dispatch name this exact value.

## Functions

### isRouterRegistrant()

```ts
function isRouterRegistrant(value): value is IRouterRegistrant;
```

Narrows an unknown initialized service to [IRouterRegistrant](#irouterregistrant).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Constructed kernel service. |

#### Returns

`value is IRouterRegistrant`

`true` when the service declares [IRouterRegistrant](#irouterregistrant).

***

### isValidRouterKind()

```ts
function isValidRouterKind(value): boolean;
```

Validates a kind token claimed during the registration window.

The shape is the kernel's open kind mechanism. The boot-time claim and the
refusal it produces belong to this package.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `string` |

#### Returns

`boolean`

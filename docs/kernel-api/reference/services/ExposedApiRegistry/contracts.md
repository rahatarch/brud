[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/ExposedApiRegistry/contracts

# Exposed API Registry (hardcore 2)

## Classes

### ExposedApiDisposedError

Raised when the Registry is used after disposal.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiDisposedError(): ExposedApiDisposedError;
```

###### Returns

[`ExposedApiDisposedError`](#exposedapidisposederror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_DISPOSED";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

***

### ExposedApiDuplicateExposureError

Raised when one identity declares the same name and major version twice.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiDuplicateExposureError(apiName, major): ExposedApiDuplicateExposureError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |
| `major` | `number` |

###### Returns

[`ExposedApiDuplicateExposureError`](#exposedapiduplicateexposureerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

API name.

##### code

```ts
readonly code: "EXPOSED_API_DUPLICATE_EXPOSURE";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### major

```ts
readonly major: number;
```

Duplicated major version.

***

### `abstract` ExposedApiError

Base class for every Registry domain failure.

#### Extends

- `Error`

#### Extended by

- [`ExposedApiDisposedError`](#exposedapidisposederror)
- [`ExposedApiDuplicateExposureError`](#exposedapiduplicateexposureerror)
- [`ExposedApiInvalidNameError`](#exposedapiinvalidnameerror)
- [`ExposedApiInvalidPolicyError`](#exposedapiinvalidpolicyerror)
- [`ExposedApiInvalidScopeError`](#exposedapiinvalidscopeerror)
- [`ExposedApiInvalidVersionError`](#exposedapiinvalidversionerror)
- [`ExposedApiNameCollisionError`](#exposedapinamecollisionerror)
- [`ExposedApiNotAttachedError`](#exposedapinotattachederror)
- [`ExposedApiOwnerPinError`](#exposedapiownerpinerror)
- [`ExposedApiRegistrationClosedError`](#exposedapiregistrationclosederror)
- [`ExposedApiScopeNarrowingError`](#exposedapiscopenarrowingerror)
- [`ExposedApiScopeRecordCorruptError`](#exposedapiscoperecordcorrupterror)
- [`ExposedApiScopeRecordPathError`](#exposedapiscoperecordpatherror)
- [`ExposedApiScopeRecordWriteError`](#exposedapiscoperecordwriteerror)
- [`ExposedApiUnavailableError`](#exposedapiunavailableerror)

#### Constructors

##### Constructor

```ts
protected new ExposedApiError(message, options?): ExposedApiError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`ExposedApiError`](#abstract-exposedapierror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: ExposedApiErrorCode;
```

Stable, machine-readable error code.

***

### ExposedApiInvalidNameError

Raised when an API name is malformed.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiInvalidNameError(apiName): ExposedApiInvalidNameError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |

###### Returns

[`ExposedApiInvalidNameError`](#exposedapiinvalidnameerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

Rejected name.

##### code

```ts
readonly code: "EXPOSED_API_INVALID_NAME";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

***

### ExposedApiInvalidPolicyError

Raised when a registration declares a malformed policy.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiInvalidPolicyError(reason): ExposedApiInvalidPolicyError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `reason` | `string` |

###### Returns

[`ExposedApiInvalidPolicyError`](#exposedapiinvalidpolicyerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_INVALID_POLICY";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### reason

```ts
readonly reason: string;
```

Human-readable reason.

***

### ExposedApiInvalidScopeError

Raised when a registration declares an unsupported scope.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiInvalidScopeError(scope): ExposedApiInvalidScopeError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `scope` | `unknown` |

###### Returns

[`ExposedApiInvalidScopeError`](#exposedapiinvalidscopeerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_INVALID_SCOPE";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### scope

```ts
readonly scope: unknown;
```

Rejected scope.

***

### ExposedApiInvalidVersionError

Raised when a registration declares an invalid API version.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiInvalidVersionError(version): ExposedApiInvalidVersionError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `version` | `unknown` |

###### Returns

[`ExposedApiInvalidVersionError`](#exposedapiinvalidversionerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_INVALID_VERSION";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### version

```ts
readonly version: unknown;
```

Rejected version.

***

### ExposedApiNameCollisionError

Raised when a second identity registers a name another identity owns.

A name is owned by the identity that first registered it, across every major
version: a version upgrade keeps ownership.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiNameCollisionError(apiName, owner): ExposedApiNameCollisionError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |
| `owner` | `string` |

###### Returns

[`ExposedApiNameCollisionError`](#exposedapinamecollisionerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

Contested API name.

##### code

```ts
readonly code: "EXPOSED_API_NAME_COLLISION";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### owner

```ts
readonly owner: string;
```

Identity token that owns the name.

***

### ExposedApiNotAttachedError

Raised when admission runs before the kernel attached its call authority.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiNotAttachedError(): ExposedApiNotAttachedError;
```

###### Returns

[`ExposedApiNotAttachedError`](#exposedapinotattachederror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_NOT_ATTACHED";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

***

### ExposedApiOwnerPinError

Raised when a registration contradicts the composition's owner pin.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiOwnerPinError(apiName): ExposedApiOwnerPinError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |

###### Returns

[`ExposedApiOwnerPinError`](#exposedapiownerpinerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

Pinned API name.

##### code

```ts
readonly code: "EXPOSED_API_OWNER_PIN";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

***

### ExposedApiRegistrationClosedError

Raised when an exposure is registered after the boot window closed.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiRegistrationClosedError(apiName): ExposedApiRegistrationClosedError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |

###### Returns

[`ExposedApiRegistrationClosedError`](#exposedapiregistrationclosederror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

Rejected API name.

##### code

```ts
readonly code: "EXPOSED_API_REGISTRATION_CLOSED";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

***

### ExposedApiScopeNarrowingError

Raised when a registration narrows a persisted scope within one version.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiScopeNarrowingError(
   apiName, 
   version, 
   persistedScope, 
   requestedScope
): ExposedApiScopeNarrowingError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `apiName` | `string` |
| `version` | `string` |
| `persistedScope` | `string` |
| `requestedScope` | `string` |

###### Returns

[`ExposedApiScopeNarrowingError`](#exposedapiscopenarrowingerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### apiName

```ts
readonly apiName: string;
```

API name.

##### code

```ts
readonly code: "EXPOSED_API_SCOPE_NARROWED";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### persistedScope

```ts
readonly persistedScope: string;
```

Scope already recorded for the identity.

##### requestedScope

```ts
readonly requestedScope: string;
```

Scope the registration requested.

##### version

```ts
readonly version: string;
```

API version.

***

### ExposedApiScopeRecordCorruptError

Raised when the protected scope record cannot be parsed or verified.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiScopeRecordCorruptError(storagePath, reason): ExposedApiScopeRecordCorruptError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |
| `reason` | `string` |

###### Returns

[`ExposedApiScopeRecordCorruptError`](#exposedapiscoperecordcorrupterror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_SCOPE_RECORD_CORRUPT";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### reason

```ts
readonly reason: string;
```

Human-readable reason.

##### storagePath

```ts
readonly storagePath: string;
```

Absolute storage path.

***

### ExposedApiScopeRecordPathError

Raised when a scope-record storage path is not an absolute file path.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiScopeRecordPathError(storagePath): ExposedApiScopeRecordPathError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |

###### Returns

[`ExposedApiScopeRecordPathError`](#exposedapiscoperecordpatherror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_SCOPE_RECORD_PATH";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### storagePath

```ts
readonly storagePath: string;
```

Rejected path.

***

### ExposedApiScopeRecordWriteError

Raised when the protected scope record cannot be written.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiScopeRecordWriteError(storagePath, reason): ExposedApiScopeRecordWriteError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |
| `reason` | `string` |

###### Returns

[`ExposedApiScopeRecordWriteError`](#exposedapiscoperecordwriteerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_SCOPE_RECORD_WRITE";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

##### reason

```ts
readonly reason: string;
```

Filesystem error code, when available.

##### storagePath

```ts
readonly storagePath: string;
```

Absolute storage path.

***

### ExposedApiUnavailableError

Raised when an exposure handle is used by a caller the exposure's policy
does not permit at the time of use.

Carries no reason. The detailed reason is on the kernel's observation
stream, so a refused caller learns nothing about why.

#### Extends

- [`ExposedApiError`](#abstract-exposedapierror)

#### Constructors

##### Constructor

```ts
new ExposedApiUnavailableError(): ExposedApiUnavailableError;
```

###### Returns

[`ExposedApiUnavailableError`](#exposedapiunavailableerror)

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "EXPOSED_API_UNAVAILABLE";
```

Stable, machine-readable error code.

###### Overrides

[`ExposedApiError`](#abstract-exposedapierror).[`code`](#code-2)

## Interfaces

### ExposedApiBinding

How a giver's code binds one declared exposure.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-projection"></a> `projection?` | `readonly` | [`ExposedApiProjection`](#exposedapiprojection) | Layer 2 projection. Defaults to the giver's instance itself. |

***

### ExposedApiCaller

Caller view handed to a giver's projection.

Every field is assigned by the kernel and read from the kernel-provided
execution context. Namespace-scoped projections bind to [identity](#property-identity).

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callerclass"></a> `callerClass` | `readonly` | `"host"` \| `"kernel"` \| `"participant"` | The caller's identity class. |
| <a id="property-capabilities"></a> `capabilities` | `readonly` | `ReadonlySet`\<`string`\> | Capabilities the caller declared it wants. |
| <a id="property-identity"></a> `identity` | `readonly` | `string` \| `null` | The caller's kernel-issued identity token. `null` for the kernel itself and for a host session, which carry no participant identity and are distinguished by [callerClass](#property-callerclass). |
| <a id="property-official"></a> `official` | `readonly` | `boolean` | The caller's official status in this composition. Kernel-derived from the identity-to-official mapping the kernel builds at boot from the composition's frozen config. Never supplied by the caller. A Layer 1 policy input. |
| <a id="property-origin"></a> `origin` | `readonly` | `"host"` \| `"kernel"` \| `"runtime"` | Root origin of the call chain. |

***

### ExposedApiIdentity

Identity of one exposed API.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `readonly` | `string` |
| <a id="property-version"></a> `version` | `readonly` | [`ExposedApiVersion`](#exposedapiversion) |

***

### ExposedApiPolicy

A validated Layer 1 policy.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callerclasses"></a> `callerClasses?` | `readonly` | readonly (`"host"` \| `"kernel"` \| `"participant"`)[] | Identity classes admitted. |
| <a id="property-capabilities-1"></a> `capabilities?` | `readonly` | readonly `string`[] | Capabilities the caller must have declared. Every one is required. |
| <a id="property-official-1"></a> `official?` | `readonly` | `boolean` | Official status the caller must hold in this composition. |
| <a id="property-origins"></a> `origins?` | `readonly` | readonly (`"host"` \| `"kernel"` \| `"runtime"`)[] | Root origins admitted, inside what the scope already admits. |
| <a id="property-parentcallerclasses"></a> `parentCallerClasses?` | `readonly` | readonly (`"host"` \| `"kernel"` \| `"participant"`)[] | Identity classes the caller's parent must belong to. Names the class of the caller's parent, never a participant's name. A top-level caller has no parent and does not satisfy a policy that names `parentCallerClasses`. Evaluated after the `callerClasses` check; the other checks continue to apply. |
| <a id="property-policyversion"></a> `policyVersion` | `readonly` | `2` | Policy language version. |

***

### ExposedApiRefusal

A refusal as the refused caller may read it.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callerclass-1"></a> `callerClass?` | `readonly` | `"host"` \| `"kernel"` \| `"participant"` | The refused caller's own class, when a call frame exists. |
| <a id="property-callerorigin"></a> `callerOrigin?` | `readonly` | `"host"` \| `"kernel"` \| `"runtime"` | The refused caller's own root origin, when a call frame exists. |
| <a id="property-code"></a> `code` | `readonly` | [`ExposedApiRefusalCode`](#exposedapirefusalcode) | Stable code. |
| <a id="property-message"></a> `message` | `readonly` | `string` | Short fixed message for logs. Never names an exposure, owner, policy or capability. |

***

### ExposedApiResolveOptions

Options for one resolve.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-expectedowner"></a> `expectedOwner?` | `readonly` | `string` | Identity token the caller expects to own the exposure. The resolve fails when the registered owner differs. |
| <a id="property-version-1"></a> `version?` | `readonly` | [`ExposedApiVersion`](#exposedapiversion) | API version: a major version or a semantic version. Defaults to 1. |

***

### IExposedApiAdmission

Registration, as only the kernel sees it.

The kernel calls `register` during admission, on each participant's behalf,
from that participant's manifest. It is never part of the view a participant
receives, and it is refused for everyone once the boot window seals.

#### Methods

##### register()

```ts
register(owner, declaration): void;
```

Registers one declared exposure for its owner.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `owner` | `string` | Kernel-issued identity token of the declaring participant. |
| `declaration` | [`ExposureDeclaration`](../../src/contracts.md#exposuredeclaration) | The exposure exactly as the manifest declares it. |

###### Returns

`void`

***

### IExposedApiRegistry

The resolution primitive, as every participant sees it.

`resolve` is open to every participant in the composition. It takes no
caller list and applies no policy of its own: it reads the caller and the
chain's root origin from the kernel-provided execution context and evaluates
the giver's declared Layer 1 policy.

#### Methods

##### lastRefusal()

```ts
lastRefusal(): ExposedApiRefusal | null;
```

Why the most recent `resolve` in the current call frame returned `null`.

Returns `null` when that resolve succeeded or none was made in this
frame. Outside any call frame (for example during a participant's
synchronous `create`) it returns `no-call-context`: exposures are not
attached yet, so every resolve is refused. The answer is scoped to the
frame, so no other caller's refusal is ever visible. It keeps the
indistinguishability above: reasons that depend on policy or on other
participants all read as `unavailable`.

###### Returns

[`ExposedApiRefusal`](#exposedapirefusal) \| `null`

##### resolve()

```ts
resolve<T>(name, options?): T | null;
```

Resolves an exposure for the current caller.

Layer 1 is evaluated here, to decide whether the caller may see the
exposure, and again on every use of the returned handle, against the root
origin of the chain using it. A handle is a reference, not a grant.

A caller the policy does not permit receives exactly what it would receive
for an exposure that does not exist: `null`. The detailed reason goes to
the kernel's observation stream.

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t"></a> `T` | `unknown` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Exposure name. |
| `options?` | [`ExposedApiResolveOptions`](#exposedapiresolveoptions) | Version and expected owner identity. |

###### Returns

`T` \| `null`

The handle, or `null`.

***

### IExposureProvider

Implemented by a participant whose code binds its declared exposures.

The participant's manifest declares its exposures; the kernel registers them
at boot from that data. On the first resolve of an exposure, the registry
asks the owner's code for the binding of that declared exposure. Code can
only bind what the manifest declared: it cannot add an exposure.

#### Methods

##### provideExposure()

```ts
provideExposure(name, major): ExposedApiBinding | undefined;
```

Returns the binding for one declared exposure, or `undefined` when the
code does not provide it.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | Declared exposure name. |
| `major` | `number` | Declared major version. |

###### Returns

[`ExposedApiBinding`](#exposedapibinding) \| `undefined`

## Type Aliases

### ExposedApiErrorCode

```ts
type ExposedApiErrorCode = 
  | "EXPOSED_API_REGISTRATION_CLOSED"
  | "EXPOSED_API_NAME_COLLISION"
  | "EXPOSED_API_INVALID_NAME"
  | "EXPOSED_API_OWNER_PIN"
  | "EXPOSED_API_DUPLICATE_EXPOSURE"
  | "EXPOSED_API_NOT_ATTACHED"
  | "EXPOSED_API_UNAVAILABLE"
  | "EXPOSED_API_INVALID_VERSION"
  | "EXPOSED_API_INVALID_SCOPE"
  | "EXPOSED_API_INVALID_POLICY"
  | "EXPOSED_API_SCOPE_NARROWED"
  | "EXPOSED_API_SCOPE_RECORD_CORRUPT"
  | "EXPOSED_API_SCOPE_RECORD_PATH"
  | "EXPOSED_API_SCOPE_RECORD_WRITE"
  | "EXPOSED_API_DISPOSED";
```

Stable, machine-readable codes for Registry failures.

***

### ExposedApiOrigin

```ts
type ExposedApiOrigin = CallOrigin;
```

Root origin of a call chain.

***

### ExposedApiPolicyDecision

```ts
type ExposedApiPolicyDecision = 
  | {
  allowed: true;
}
  | {
  allowed: false;
  reason: string;
};
```

Outcome of one Layer 1 evaluation.

***

### ExposedApiProjection

```ts
type ExposedApiProjection = (service, caller) => unknown;
```

Projects a giver's instance into the view one caller receives.

This is Layer 2: optional narrowing by the giver. It runs only after the
kernel has enforced Layer 1, and it can never widen what Layer 1 decided,
because Layer 1 is evaluated again on every use of the handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `service` | `unknown` |
| `caller` | [`ExposedApiCaller`](#exposedapicaller) |

#### Returns

`unknown`

***

### ExposedApiRefusalCode

```ts
type ExposedApiRefusalCode = 
  | "no-call-context"
  | "registry-closed"
  | "limit-exceeded"
  | "malformed-request"
  | "unavailable";
```

Why the last `resolve` in a call frame returned `null`.

`unavailable` deliberately covers every reason that depends on another
participant or on policy (no such exposure, policy refuses, owner not live,
owner mismatch, owner code does not provide it): a caller cannot learn from
it whether an exposure exists. The other codes depend only on the caller's
own request or state.

***

### ExposedApiScope

```ts
type ExposedApiScope = typeof EXPOSED_API_SCOPES[number];
```

Reachability scope declared by an exposed API identity.

***

### ExposedApiVersion

```ts
type ExposedApiVersion = number | string;
```

API version.

A positive integer is a major version. A string must be a semantic version.

## Variables

### EXPOSED\_API\_MAX\_POLICY\_BYTES

```ts
const EXPOSED_API_MAX_POLICY_BYTES: 65536 = 65_536;
```

Largest accepted canonical policy size in bytes.

***

### EXPOSED\_API\_NAME\_PATTERN

```ts
const EXPOSED_API_NAME_PATTERN: RegExp;
```

API names accept dotted, kebab, and snake segments.

***

### EXPOSED\_API\_ORIGINS

```ts
const EXPOSED_API_ORIGINS: readonly ["kernel", "runtime", "host"] = CALL_ORIGINS;
```

The three root origins a call chain can carry. Assigned by the kernel.

***

### EXPOSED\_API\_POLICY\_VERSION

```ts
const EXPOSED_API_POLICY_VERSION: 2 = 2;
```

The only policy language version this registry evaluates.

Version 2 adds `parentCallerClasses`. A version-1 policy is refused by the
version-2 evaluator, fail-closed, the same way an unknown version is refused:
`parseExposedApiPolicy` requires `policyVersion === EXPOSED_API_POLICY_VERSION`.
The bump is intentional. A version-1 declaration predates the parent-class
check and must be re-declared at version 2 to be evaluated, so no version-1
policy can reach the evaluator without having passed the version check.

***

### EXPOSED\_API\_SCOPES

```ts
const EXPOSED_API_SCOPES: readonly ["kernel", "runtime", "host", "any"];
```

The four reachability scopes, ordered from narrowest to widest.

## Functions

### evaluateExposedApiPolicy()

```ts
function evaluateExposedApiPolicy(
   policy, 
   scope, 
   context
): ExposedApiPolicyDecision;
```

Evaluates a Layer 1 policy for one call.

Deterministic: the same policy, scope, and kernel-provided context always
produce the same decision. Nothing a caller supplies is an input.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `policy` | [`ExposedApiPolicy`](#exposedapipolicy) | Validated policy. |
| `scope` | `"host"` \| `"kernel"` \| `"runtime"` \| `"any"` | The exposure's recorded scope. |
| `context` | `ExposedApiEvaluationContext` | The kernel-provided context of the call. |

#### Returns

[`ExposedApiPolicyDecision`](#exposedapipolicydecision)

***

### exposedApiMajor()

```ts
function exposedApiMajor(version): number;
```

Returns the major version of a valid API version.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `version` | [`ExposedApiVersion`](#exposedapiversion) | A valid API version. |

#### Returns

`number`

***

### exposedApiScopeAllowsOrigin()

```ts
function exposedApiScopeAllowsOrigin(scope, origin): boolean;
```

Applies the four-case origin-and-scope rule.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `scope` | `"host"` \| `"kernel"` \| `"runtime"` \| `"any"` | Scope declared by the API identity. |
| `origin` | `"host"` \| `"kernel"` \| `"runtime"` | Root origin of the call chain. |

#### Returns

`boolean`

***

### exposedApiScopeRank()

```ts
function exposedApiScopeRank(scope): number;
```

Returns the order rank of a scope. Higher is wider.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `scope` | `"host"` \| `"kernel"` \| `"runtime"` \| `"any"` | Supported scope. |

#### Returns

`number`

***

### exposureBindingKey()

```ts
function exposureBindingKey(name, major): string;
```

Key of one binding: `name@major`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `major` | `number` |

#### Returns

`string`

***

### isExposedApiOrigin()

```ts
function isExposedApiOrigin(value): value is "host" | "kernel" | "runtime";
```

Reports whether a value is a supported root origin.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Candidate value. |

#### Returns

value is "host" \| "kernel" \| "runtime"

***

### isExposedApiScope()

```ts
function isExposedApiScope(value): value is "host" | "kernel" | "runtime" | "any";
```

Reports whether a value is a supported scope.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Candidate value. |

#### Returns

value is "host" \| "kernel" \| "runtime" \| "any"

***

### isExposedApiVersion()

```ts
function isExposedApiVersion(value): value is ExposedApiVersion;
```

Reports whether a value is a valid API version.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Candidate value. |

#### Returns

`value is ExposedApiVersion`

***

### isExposureProvider()

```ts
function isExposureProvider(value): value is IExposureProvider;
```

Narrows an initialized instance to [IExposureProvider](#iexposureprovider).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Initialized participant instance. |

#### Returns

`value is IExposureProvider`

***

### parseExposedApiPolicy()

```ts
function parseExposedApiPolicy(value): ExposedApiPolicy;
```

Validates and freezes a Layer 1 policy declaration.

An omitted policy is the empty version-1 policy: the exposure's scope alone
decides reachability.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Declared policy, or `undefined`. |

#### Returns

[`ExposedApiPolicy`](#exposedapipolicy)

#### Throws

When the declaration is not a valid
version-1 policy.

***

### withExposureBindings()

```ts
function withExposureBindings<T>(instance, bindings): T;
```

Attaches exposure bindings to an instance its factory returns.

The method is non-enumerable so it never appears in projections or
diagnostics. A binding key is `name@major`.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` *extends* `object` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `instance` | `T` | Instance returned by a descriptor factory. |
| `bindings` | `Readonly`\<`Record`\<`string`, [`ExposedApiBinding`](#exposedapibinding)\>\> | Bindings for the exposures the manifest declares. |

#### Returns

`T`

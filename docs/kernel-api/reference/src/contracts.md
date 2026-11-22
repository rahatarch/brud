[**BrudOS Kernel API**](../README.md)

***

[BrudOS Kernel API](../README.md) / src/contracts

# Kernel contracts

## Classes

### `abstract` AccessDeniedError

Base class for every rejection produced by a service access policy.

Callers should branch on this type when they only need to know that the
broker refused access; the concrete subclasses carry the finer reason.

#### Extends

- `Error`

#### Extended by

- [`BlacklistedAccessViolationError`](#blacklistedaccessviolationerror)
- [`AllowlistViolationError`](#allowlistviolationerror)
- [`CallerIdentityMismatchError`](#calleridentitymismatcherror)

#### Constructors

##### Constructor

```ts
protected new AccessDeniedError(
   message, 
   callerId, 
   targetServiceId
): AccessDeniedError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | Path-free, human-readable denial description. |
| `callerId` | `string` | Identifier of the caller that attempted access. |
| `targetServiceId` | `string` | Identifier of the service that denied access. |

###### Returns

[`AccessDeniedError`](#abstract-accessdeniederror)

###### Overrides

`Error.constructor`

#### Properties

##### callerId

```ts
readonly callerId: string;
```

Identifier of the caller that attempted access.

##### code

```ts
abstract readonly code: string;
```

Stable, machine-readable error code.

##### targetServiceId

```ts
readonly targetServiceId: string;
```

Identifier of the service that denied access.

***

### AllowlistViolationError

Base class for every rejection produced by a service access policy.

Callers should branch on this type when they only need to know that the
broker refused access; the concrete subclasses carry the finer reason.

#### Extends

- [`AccessDeniedError`](#abstract-accessdeniederror)

#### Constructors

##### Constructor

```ts
new AllowlistViolationError(callerId, targetServiceId): AllowlistViolationError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callerId` | `string` | Identifier of the caller that attempted access. |
| `targetServiceId` | `string` | Identifier of the service that denied access. |

###### Returns

[`AllowlistViolationError`](#allowlistviolationerror)

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`constructor`](#constructor)

#### Properties

##### callerId

```ts
readonly callerId: string;
```

Identifier of the caller that attempted access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`callerId`](#callerid)

##### code

```ts
readonly code: "NOT_IN_ALLOWLIST";
```

Stable, machine-readable error code.

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`code`](#code)

##### targetServiceId

```ts
readonly targetServiceId: string;
```

Identifier of the service that denied access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`targetServiceId`](#targetserviceid)

***

### BlacklistedAccessViolationError

Raised when a caller matches the deny list of a service's access policy.

#### Extends

- [`AccessDeniedError`](#abstract-accessdeniederror)

#### Constructors

##### Constructor

```ts
new BlacklistedAccessViolationError(
   callerId, 
   targetServiceId, 
   reason
): BlacklistedAccessViolationError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callerId` | `string` | Identifier of the caller that attempted access. |
| `targetServiceId` | `string` | Identifier of the service that denied access. |
| `reason` | `string` | Explanation of why the caller was denied. |

###### Returns

[`BlacklistedAccessViolationError`](#blacklistedaccessviolationerror)

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`constructor`](#constructor)

#### Properties

##### callerId

```ts
readonly callerId: string;
```

Identifier of the caller that attempted access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`callerId`](#callerid)

##### code

```ts
readonly code: "BLACKLISTED_ACCESS";
```

Stable, machine-readable error code.

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`code`](#code)

##### reason

```ts
readonly reason: string;
```

Explanation of why the caller was denied.

##### targetServiceId

```ts
readonly targetServiceId: string;
```

Identifier of the service that denied access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`targetServiceId`](#targetserviceid)

***

### CallerIdentityMismatchError

Raised when a caller inside a kernel call chain asserts a caller id that is
not the identity the kernel admitted it with. Token access binds to the
call chain: a participant can only ever be itself.

#### Extends

- [`AccessDeniedError`](#abstract-accessdeniederror)

#### Constructors

##### Constructor

```ts
new CallerIdentityMismatchError(
   assertedCallerId, 
   targetServiceId, 
   boundCallerId
): CallerIdentityMismatchError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `assertedCallerId` | `string` | Caller id the requester supplied. |
| `targetServiceId` | `string` | Identifier of the service requested. |
| `boundCallerId` | `string` \| `undefined` | Caller id the call chain binds the requester to, if any. |

###### Returns

[`CallerIdentityMismatchError`](#calleridentitymismatcherror)

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`constructor`](#constructor)

#### Properties

##### callerId

```ts
readonly callerId: string;
```

Identifier of the caller that attempted access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`callerId`](#callerid)

##### code

```ts
readonly code: "CALLER_IDENTITY_MISMATCH";
```

Stable, machine-readable error code.

###### Overrides

[`AccessDeniedError`](#abstract-accessdeniederror).[`code`](#code)

##### targetServiceId

```ts
readonly targetServiceId: string;
```

Identifier of the service that denied access.

###### Inherited from

[`AccessDeniedError`](#abstract-accessdeniederror).[`targetServiceId`](#targetserviceid)

***

### ContextContract

Per-kernel declaration store and validator.

The class is generic: it understands dotted namespaces, primitive types, and
ownership, but no concrete field name.

#### Constructors

##### Constructor

```ts
new ContextContract(): ContextContract;
```

###### Returns

[`ContextContract`](#contextcontract)

#### Accessors

##### isLocked

###### Get Signature

```ts
get isLocked(): boolean;
```

`true` once the kernel has reached `RUNNING`.

###### Returns

`boolean`

#### Methods

##### assertNamespaced()

```ts
assertNamespaced(options): void;
```

Refuses a string option that is not a dotted namespace path.

String-valued options are contract fields. Flat aliases have no service
owner and cannot be read, so one is reported as that, not as a missing
field.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Host-supplied values. |

###### Returns

`void`

###### Throws

When a flat string option is present.

##### declare()

```ts
declare(
   ownerId, 
   scopeOrDeclaration, 
   fields?
): void;
```

Records one service's declarations.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `ownerId` | `string` | Stable identity of the declaring module. |
| `scopeOrDeclaration` | `string` \| [`ContextScopeDeclaration`](#contextscopedeclaration) | Namespace string or a complete scope declaration. |
| `fields?` | readonly [`ContextFieldDeclaration`](#contextfielddeclaration)[] | Fields to declare when the second argument is a scope string. |

###### Returns

`void`

##### lock()

```ts
lock(): void;
```

Prevents any further declaration.

###### Returns

`void`

##### missingRequiredByOwner()

```ts
missingRequiredByOwner(options): ReadonlyMap<string, readonly string[]>;
```

Lists, per declaring owner, the required fields the bag does not carry.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Host-supplied values. |

###### Returns

`ReadonlyMap`\<`string`, readonly `string`[]\>

Owner id mapped to its missing required field names.

##### schema()

```ts
schema(): ContextSchema;
```

Returns an immutable snapshot of the current schema.

###### Returns

[`ContextSchema`](#contextschema)

##### validate()

```ts
validate(options): void;
```

Validates an options bag against every accepted declaration.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Host-supplied values carried through unchanged. |

###### Returns

`void`

###### Throws

When a required field is missing or a value
has the wrong type.

***

### ContextContractError

Raised when a declaration, a field name, or a value violates the contract.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new ContextContractError(message, details?): ContextContractError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `details?` | \{ `actualType?`: `string`; `expectedType?`: `"string"` \| `"number"` \| `"boolean"` \| `"object"`; `field?`: `string`; `service?`: `string`; \} |
| `details.actualType?` | `string` |
| `details.expectedType?` | `"string"` \| `"number"` \| `"boolean"` \| `"object"` |
| `details.field?` | `string` |
| `details.service?` | `string` |

###### Returns

[`ContextContractError`](#contextcontracterror)

###### Overrides

`Error.constructor`

#### Properties

##### actualType

```ts
readonly actualType: string | undefined;
```

Actual value type observed, when the violation is a type mismatch.

##### code

```ts
readonly code: "CONTEXT_CONTRACT_VIOLATION" = 'CONTEXT_CONTRACT_VIOLATION';
```

##### expectedType

```ts
readonly expectedType: "string" | "number" | "boolean" | "object" | undefined;
```

Expected primitive type, when the violation is a type mismatch.

##### field

```ts
readonly field: string | undefined;
```

Field involved in the violation, when one exists.

##### service

```ts
readonly service: string | undefined;
```

Namespace/service involved in the violation, when one exists.

***

### ParticipantManifestError

Raised when a manifest is not valid declarative data.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new ParticipantManifestError(participant, reason): ParticipantManifestError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `participant` | `string` |
| `reason` | `string` |

###### Returns

[`ParticipantManifestError`](#participantmanifesterror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
readonly code: "PARTICIPANT_MANIFEST_INVALID";
```

##### participant

```ts
readonly participant: string;
```

Token id of the participant whose manifest was refused.

## Interfaces

### AdmittedManifest

A manifest after the kernel has validated and frozen it.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-capabilities"></a> `capabilities` | `readonly` | readonly `string`[] | Requested capability tokens, deduplicated, in declaration order. |
| <a id="property-events"></a> `events` | `readonly` | readonly [`EventDeclaration`](#eventdeclaration)[] | Declared events, deep-copied and frozen. |
| <a id="property-exposures"></a> `exposures` | `readonly` | readonly [`ExposureDeclaration`](#exposuredeclaration)[] | Declared exposures, deep-copied and frozen. |
| <a id="property-interceptionpoints"></a> `interceptionPoints` | `readonly` | readonly [`InterceptionPointDeclaration`](#interceptionpointdeclaration)[] | Declared interception points, deep-copied and frozen. |
| <a id="property-interceptions"></a> `interceptions` | `readonly` | readonly [`InterceptionDeclaration`](#interceptiondeclaration)[] | Declared interceptions, deep-copied and frozen. |
| <a id="property-kinds"></a> `kinds` | `readonly` | readonly [`KindDeclaration`](#kinddeclaration)[] | - |

***

### ContextFieldDeclaration

One field a service requires or accepts from the options bag.

#### Extended by

- [`ContextFieldSchema`](#contextfieldschema)

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-description"></a> `description` | `readonly` | `string` | Short explanation of what the field is for. |
| <a id="property-name"></a> `name` | `readonly` | `string` | Dotted field name inside the declaring service's namespace. |
| <a id="property-required"></a> `required` | `readonly` | `boolean` | Whether the field must be present when a context is created. |
| <a id="property-type"></a> `type` | `readonly` | `"string"` \| `"number"` \| `"boolean"` \| `"object"` | Primitive type the value must have. |

***

### ContextFieldSchema

A field after the kernel has accepted a declaration.

#### Extends

- [`ContextFieldDeclaration`](#contextfielddeclaration)

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-description-1"></a> `description` | `readonly` | `string` | Short explanation of what the field is for. | [`ContextFieldDeclaration`](#contextfielddeclaration).[`description`](#property-description) |
| <a id="property-name-1"></a> `name` | `readonly` | `string` | Dotted field name inside the declaring service's namespace. | [`ContextFieldDeclaration`](#contextfielddeclaration).[`name`](#property-name) |
| <a id="property-required-1"></a> `required` | `readonly` | `boolean` | Whether the field must be present when a context is created. | [`ContextFieldDeclaration`](#contextfielddeclaration).[`required`](#property-required) |
| <a id="property-service"></a> `service` | `readonly` | `string` | Service that owns the namespace and declared the field. | - |
| <a id="property-type-1"></a> `type` | `readonly` | `"string"` \| `"number"` \| `"boolean"` \| `"object"` | Primitive type the value must have. | [`ContextFieldDeclaration`](#contextfielddeclaration).[`type`](#property-type) |

***

### ContextSchema

The complete, introspectable contract for one kernel.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-fields"></a> `fields` | `readonly` | readonly [`ContextFieldSchema`](#contextfieldschema)[] | Accepted fields in declaration order. |
| <a id="property-locked"></a> `locked` | `readonly` | `boolean` | Whether further declarations are rejected. |

***

### ContextScopeDeclaration

One service's set of declarations for a single namespace.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-fields-1"></a> `fields` | `readonly` | readonly [`ContextFieldDeclaration`](#contextfielddeclaration)[] | Fields declared inside that namespace. |
| <a id="property-scope"></a> `scope` | `readonly` | `string` | Namespace owned by the declaring service. |

***

### EventDeclaration

One event a participant declares.

A separate type from [ExposureDeclaration](#exposuredeclaration): events are a push-model
observable, not a pull-model callable. For Step 3 the field set matches the
exposure declaration; the payload schema is deferred to the delivery step.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-name-2"></a> `name` | `readonly` | `string` | Stable event name. |
| <a id="property-payloadschema"></a> `payloadSchema?` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | JSON Schema subset the emitted payload must satisfy. Admission checks only that it is an object; the schema itself is compiled and enforced at emit. |
| <a id="property-policy"></a> `policy?` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Declarative Layer 1 policy for this event. |
| <a id="property-scope-1"></a> `scope?` | `readonly` | `string` | Reachability scope. |
| <a id="property-version"></a> `version?` | `readonly` | `string` \| `number` | Version: a positive integer major version or a semantic version. |

***

### ExecutionContext

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-calldepth"></a> `callDepth` | `readonly` | `number` | - |
| <a id="property-metadata"></a> `metadata?` | `readonly` | `Record`\<`string`, `unknown`\> | - |
| <a id="property-options"></a> `options` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Opaque host-supplied options bag. The kernel stores the bag at boot and attaches it unchanged to every execution context. The core never inspects a key; operations read the options their own domain owns. |
| <a id="property-sessionid"></a> `sessionId` | `readonly` | `string` | - |
| <a id="property-signal"></a> `signal?` | `readonly` | `AbortSignal` | - |

#### Methods

##### createChildContext()

```ts
createChildContext(overrides?): ExecutionContext;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `overrides?` | `Partial`\<[`ExecutionContext`](#executioncontext)\> |

###### Returns

[`ExecutionContext`](#executioncontext)

##### invoke()

```ts
invoke<TInput, TOutput>(kind, input): Promise<OperationResult<TOutput>>;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tinput"></a> `TInput` |
| <a id="type-parameter-toutput"></a> `TOutput` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | `string` |
| `input` | `TInput` |

###### Returns

`Promise`\<[`OperationResult`](#operationresult)\<`TOutput`\>\>

##### resolve()

```ts
resolve<T>(token): T;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | [`Token`](#token)\<`T`\> |

###### Returns

`T`

***

### ExposureDeclaration

One exposure a participant declares.

The resolution primitive interprets and validates every field. The kernel
core carries the declaration unchanged.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-name-3"></a> `name` | `readonly` | `string` | Stable exposure name. |
| <a id="property-policy-1"></a> `policy?` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Declarative Layer 1 policy for this exposure. |
| <a id="property-scope-2"></a> `scope?` | `readonly` | `string` | Reachability scope. |
| <a id="property-version-1"></a> `version?` | `readonly` | `string` \| `number` | Version: a positive integer major version or a semantic version. |

***

### IBrudKernel

Root microkernel contract governing service registration and lifecycle.

#### Extends

- [`IKernelAccessBroker`](#ikernelaccessbroker)

#### Methods

##### boot()

```ts
boot(options): Promise<void>;
```

Initializes every registered service in dependency order.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | [`KernelBootOptions`](#kernelbootoptions) | Boot configuration. |

###### Returns

`Promise`\<`void`\>

##### getContextSchema()

```ts
getContextSchema(): ContextSchema;
```

Returns the dynamically built context schema.

###### Returns

[`ContextSchema`](#contextschema)

##### hasService()

```ts
hasService(token): boolean;
```

Reports whether a service is registered.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | [`ServiceToken`](#servicetoken)\<`unknown`\> | Token identifying the service. |

###### Returns

`boolean`

###### Inherited from

[`IKernelAccessBroker`](#ikernelaccessbroker).[`hasService`](#hasservice-1)

##### listServices()

```ts
listServices(): readonly ServiceInfo[];
```

Lists metadata for every registered service.

###### Returns

readonly [`ServiceInfo`](#serviceinfo)[]

###### Inherited from

[`IKernelAccessBroker`](#ikernelaccessbroker).[`listServices`](#listservices-1)

##### readObservations()

```ts
readObservations(): readonly KernelObservation[];
```

Reads the kernel's observation stream.

Detailed denial reasons are recorded here, never returned to the refused
caller. Only the holder of the kernel object can read the stream.

###### Returns

readonly [`KernelObservation`](#kernelobservation)[]

##### register()

```ts
register<TService>(descriptor): void;
```

Registers a service descriptor. Must be called before [boot](#boot).

###### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-tservice"></a> `TService` | The public interface exposed by the service. |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `descriptor` | [`ServiceDescriptor`](#servicedescriptor)\<`TService`\> | Self-describing registration record. |

###### Returns

`void`

##### requestAccess()

```ts
requestAccess<TService>(caller, token): TService;
```

Resolves a service for the given caller.

###### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-tservice-1"></a> `TService` | The public interface carried by `token`. |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `caller` | [`ServiceContext`](#servicecontext) | Context identifying the requesting caller. |
| `token` | [`ServiceToken`](#servicetoken)\<`TService`\> | Token identifying the requested service. |

###### Returns

`TService`

The caller-facing view of the service.

###### Inherited from

[`IKernelAccessBroker`](#ikernelaccessbroker).[`requestAccess`](#requestaccess-1)

##### runHostCall()

```ts
runHostCall<T>(session, operation): T;
```

Runs an operation inside a host-origin call chain.

This is the only way a chain gets the `host` origin. It is a method of the
kernel object, which only the host holds; a participant receives the access
broker, never the kernel. The host calls it from its authenticated session.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `session` | [`KernelHostSession`](#kernelhostsession) | The host session's declaration. |
| `operation` | () => `T` | Work performed inside the host-origin chain. |

###### Returns

`T`

##### shutdown()

```ts
shutdown(): Promise<void>;
```

Disposes every initialized service in reverse dependency order.

###### Returns

`Promise`\<`void`\>

##### validateContextOptions()

```ts
validateContextOptions(options): void;
```

Validates an options bag against the locked context schema.

Used by hosts that build a fresh context after boot.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Readonly`\<`Record`\<`string`, `unknown`\>\> |

###### Returns

`void`

##### withLifecycleGateSuspended()?

```ts
withLifecycleGateSuspended?<T>(operation): Promise<T>;
```

Suspends the lifecycle gate for a bounded boot-window operation.

This is a general rule available to every participant on the same terms,
not a service-specific exception. It removes only the "broker is idle"
state check while the operation runs; every access policy, denial list,
and allowlist still applies, so a suspended gate never widens authority.
The kernel uses it around the boot pinner, where any module's
`pinBootPolicies` hook may ingest its boot snapshot before `RUNNING`.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-2"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `operation` | () => `Promise`\<`T`\> | Work performed while the gate is suspended. |

###### Returns

`Promise`\<`T`\>

###### Inherited from

[`IKernelAccessBroker`](#ikernelaccessbroker).[`withLifecycleGateSuspended`](#withlifecyclegatesuspended-1)

***

### IExecutionPipeline

#### Methods

##### execute()

```ts
execute<TInput, TOutput>(
   handler, 
   context, 
   input
): Promise<OperationResult<TOutput>>;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tinput-1"></a> `TInput` |
| <a id="type-parameter-toutput-1"></a> `TOutput` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | [`OperationHandler`](#operationhandler)\<`TInput`, `TOutput`\> |
| `context` | [`ExecutionContext`](#executioncontext) |
| `input` | `TInput` |

###### Returns

`Promise`\<[`OperationResult`](#operationresult)\<`TOutput`\>\>

##### use()

```ts
use(middleware): void;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `middleware` | [`Middleware`](#middleware) |

###### Returns

`void`

***

### IKernelAccessBroker

Mediated entry point for resolving services across the microkernel boundary.

Every resolution is subject to the target service's access policy and the
caller's [ServiceContext](#servicecontext).

#### Extended by

- [`IBrudKernel`](#ibrudkernel)

#### Methods

##### hasService()

```ts
hasService(token): boolean;
```

Reports whether a service is registered.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | [`ServiceToken`](#servicetoken)\<`unknown`\> | Token identifying the service. |

###### Returns

`boolean`

##### listServices()

```ts
listServices(): readonly ServiceInfo[];
```

Lists metadata for every registered service.

###### Returns

readonly [`ServiceInfo`](#serviceinfo)[]

##### requestAccess()

```ts
requestAccess<TService>(caller, token): TService;
```

Resolves a service for the given caller.

###### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-tservice-2"></a> `TService` | The public interface carried by `token`. |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `caller` | [`ServiceContext`](#servicecontext) | Context identifying the requesting caller. |
| `token` | [`ServiceToken`](#servicetoken)\<`TService`\> | Token identifying the requested service. |

###### Returns

`TService`

The caller-facing view of the service.

##### withLifecycleGateSuspended()?

```ts
withLifecycleGateSuspended?<T>(operation): Promise<T>;
```

Suspends the lifecycle gate for a bounded boot-window operation.

This is a general rule available to every participant on the same terms,
not a service-specific exception. It removes only the "broker is idle"
state check while the operation runs; every access policy, denial list,
and allowlist still applies, so a suspended gate never widens authority.
The kernel uses it around the boot pinner, where any module's
`pinBootPolicies` hook may ingest its boot snapshot before `RUNNING`.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-3"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `operation` | () => `Promise`\<`T`\> | Work performed while the gate is suspended. |

###### Returns

`Promise`\<`T`\>

***

### InterceptionDeclaration

One interception a participant declares: it asks to intercept calls to an
exposure another participant gives. Held only by the interception hardcore;
it is not an exposure and is not reachable through `resolve`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-target"></a> `target` | `readonly` | `string` | Exposure name to intercept. |
| <a id="property-version-2"></a> `version?` | `readonly` | `string` \| `number` | Major version of the target; defaults to 1. |

***

### InterceptionPointDeclaration

One interception point a giver declares on one of its own exposures, naming
(by service token) the interceptors it admits, in the order they run.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-admit"></a> `admit` | `readonly` | readonly `string`[] | Service tokens of the admitted interceptors, in run order. |
| <a id="property-description-2"></a> `description?` | `readonly` | `string` | Optional public description of the kind (shown to remote clients). |
| <a id="property-exposure"></a> `exposure` | `readonly` | `string` | The giver's own exposure name. |
| <a id="property-operations"></a> `operations?` | `readonly` | `Readonly`\<`Record`\<`string`, `KindOperationDescription`\>\> | Optional public operations of the kind: name → description and a JSON Schema for its input. Plain JSON data; the owner may serve more. |
| <a id="property-version-3"></a> `version?` | `readonly` | `string` \| `number` | Major version of the exposure; defaults to 1. |

***

### IOperationRegistry

#### Methods

##### get()

```ts
get<TInput, TOutput>(kind): 
  | OperationHandler<TInput, TOutput>
  | undefined;
```

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-tinput-2"></a> `TInput` | `unknown` |
| <a id="type-parameter-toutput-2"></a> `TOutput` | `unknown` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | `string` |

###### Returns

  \| [`OperationHandler`](#operationhandler)\<`TInput`, `TOutput`\>
  \| `undefined`

##### has()

```ts
has(kind): boolean;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | `string` |

###### Returns

`boolean`

##### list()

```ts
list(): readonly OperationHandler<unknown, unknown>[];
```

###### Returns

readonly [`OperationHandler`](#operationhandler)\<`unknown`, `unknown`\>[]

##### register()

```ts
register(handler): void;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | [`OperationHandler`](#operationhandler) |

###### Returns

`void`

***

### IServiceContainer

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-isfrozen"></a> `isFrozen` | `readonly` | `boolean` |

#### Methods

##### createChildScope()

```ts
createChildScope(): IServiceContainer;
```

###### Returns

[`IServiceContainer`](#iservicecontainer)

##### freeze()

```ts
freeze(): void;
```

###### Returns

`void`

##### has()

```ts
has<T>(token): boolean;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-4"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | [`Token`](#token)\<`T`\> |

###### Returns

`boolean`

##### register()

```ts
register<T>(token, provider): void;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-5"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | [`Token`](#token)\<`T`\> |
| `provider` | `T` \| (() => `T`) |

###### Returns

`void`

##### resolve()

```ts
resolve<T>(token): T;
```

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-6"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | [`Token`](#token)\<`T`\> |

###### Returns

`T`

***

### IServiceLifecycle

Optional lifecycle hooks a service may implement.

#### Methods

##### dispose()?

```ts
dispose?(): void | Promise<void>;
```

Releases resources held by the service. Called once during shutdown.

###### Returns

`void` \| `Promise`\<`void`\>

##### initialize()?

```ts
initialize?(broker): void | Promise<void>;
```

Prepares the service for use. Called once during kernel boot.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `broker` | [`IKernelAccessBroker`](#ikernelaccessbroker) | Mediated access broker for resolving dependencies. |

###### Returns

`void` \| `Promise`\<`void`\>

##### onRunning()?

```ts
onRunning?(broker): void | Promise<void>;
```

Starts work that needs other services through the broker. Called once,
after the kernel enters `RUNNING` and before `boot()` resolves, in the same
dependency order as [IServiceLifecycle.initialize](#initialize).

The broker grants access here, unlike during `initialize()`. If this hook
throws, the kernel disposes every initialized service in reverse order,
ends `DISPOSED`, and `boot()` rejects with the original error.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `broker` | [`IKernelAccessBroker`](#ikernelaccessbroker) | Mediated access broker for resolving dependencies. |

###### Returns

`void` \| `Promise`\<`void`\>

***

### KernelBootOptions

Options controlling a kernel boot sequence.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-logger"></a> `logger?` | `readonly` | [`KernelLogger`](#kernellogger) | Optional diagnostic sink forwarded to every service context. |
| <a id="property-options-1"></a> `options?` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Open options bag supplied by the host and forwarded to services. |

***

### KernelCallAuthority

Kernel authority over the call chain.

The kernel hands this only to root primitives, through the hardcore boot
context. It is never reachable through the access broker.

#### Methods

##### admitCall()

```ts
admitCall(caller, requestBytes): boolean;
```

Applies the per-identity call and size limits to one mediated call.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `caller` | [`KernelCaller`](#kernelcaller) | The caller making the call. |
| `requestBytes` | `number` | Size of the call's request. |

###### Returns

`boolean`

`true` when the call is within the limits.

##### callerForIdentity()

```ts
callerForIdentity(identity): KernelCaller | undefined;
```

The kernel caller recorded for an identity token, or `undefined`.

Reads the same admission record `isLive` and `instanceOf` read. Used to
resolve the caller's class for a caller that is named by another caller's
frame — the parent of a caged child — without the caller supplying it.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `identity` | `string` | Kernel-issued identity token. |

###### Returns

[`KernelCaller`](#kernelcaller) \| `undefined`

##### current()

```ts
current(): KernelCallContext | undefined;
```

The current call's kernel-provided context, or `undefined` outside a chain.

###### Returns

[`KernelCallContext`](#kernelcallcontext) \| `undefined`

##### instanceOf()

```ts
instanceOf(identity): unknown;
```

The initialized instance of a live participant, or `undefined`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `identity` | `string` |

###### Returns

`unknown`

##### isLive()

```ts
isLive(identity): boolean;
```

Whether an identity is live in the composition.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `identity` | `string` |

###### Returns

`boolean`

##### observe()

```ts
observe(
   source, 
   event, 
   detail
): void;
```

Appends one record to the kernel's observation stream.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `source` | `string` |
| `event` | `string` |
| `detail` | `Readonly`\<`Record`\<`string`, `unknown`\>\> |

###### Returns

`void`

##### runAs()

```ts
runAs<T>(identity, operation): T;
```

Runs an operation as an admitted participant, keeping the root origin.

Used when the kernel mediates a call into a participant's code. The chain's
root origin does not change.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-7"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `identity` | `string` | Kernel-issued identity token of the participant. |
| `operation` | () => `T` | Work performed as that participant. |

###### Returns

`T`

###### Throws

When no chain is active or the identity is not live.

##### runAsOrigin()

```ts
runAsOrigin<T>(
   origin, 
   identity, 
   operation
): T;
```

Starts a chain with the given origin and a participant's recorded caller.

The caller is the participant the kernel admitted under `identity`; it is
resolved from the same admission record [callerForIdentity](#callerforidentity) reads, so
the frame carries the participant's kernel-issued identity and its parent
relation exactly as the kernel recorded them. Unlike [runAs](#runas), this
member sets the chain's root origin and does not require an active chain.
It composes what the kernel's own root-start and run-as paths do, without
exposing either.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-8"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `origin` | `"host"` \| `"kernel"` \| `"runtime"` | Root origin the new chain starts with. |
| `identity` | `string` | Kernel-issued identity token of the participant. |
| `operation` | () => `T` | Work performed inside the chain as that participant. |

###### Returns

`T`

###### Throws

When the identity is not live in this composition.

***

### KernelCallContext

The kernel-provided execution context of the current call.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-caller"></a> `caller` | `readonly` | [`KernelCaller`](#kernelcaller) | The caller currently executing inside the chain. |
| <a id="property-origin"></a> `origin` | `readonly` | `"host"` \| `"kernel"` \| `"runtime"` | Root origin fixed when the chain started; propagated unchanged. |

***

### KernelCaller

A caller as the kernel knows it.

Every field is assigned by the kernel. A participant cannot set any of them.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callerclass"></a> `callerClass` | `readonly` | `"host"` \| `"kernel"` \| `"participant"` | Identity class of the caller. |
| <a id="property-capabilities-1"></a> `capabilities` | `readonly` | `ReadonlySet`\<`string`\> | Capabilities the caller declared it wants. A request, not a grant. |
| <a id="property-identity"></a> `identity` | `readonly` | `string` \| `null` | Kernel-issued identity token of the caller. Present for an admitted participant. `null` for the kernel itself and for a host session, which are identified by their class. |
| <a id="property-official"></a> `official` | `readonly` | `boolean` | The caller's official status in this composition. Read from the kernel's identity-to-official mapping, which the kernel builds at boot from the composition's frozen config. Never supplied by the caller. |
| <a id="property-parentidentity"></a> `parentIdentity?` | `readonly` | `string` | The parent's kernel-issued identity token, when the caller is a caged child. Optional. A top-level participant has no parent and omits the field. A caged child carries the identity token of the participant that loaded it, or the cage's own identity token, as the kernel issued it at admission. The value is the parent's identity, never the parent's name, token id, or descriptor label. The child's own identity is separate and unchanged. |

***

### KernelCallLimits

Per-identity limits applied to every call the kernel mediates.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-maxcallsperwindow"></a> `maxCallsPerWindow` | `readonly` | `number` | Calls one caller may make inside one window. |
| <a id="property-maxrequestbytes"></a> `maxRequestBytes` | `readonly` | `number` | Largest accepted request size, in bytes, for one mediated call. |
| <a id="property-windowms"></a> `windowMs` | `readonly` | `number` | Window length in milliseconds. |

***

### KernelHostSession

A host session's declaration when it enters a host-origin chain.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-capabilities-2"></a> `capabilities?` | `readonly` | `Iterable`\<`string`, `any`, `any`\> | Capabilities the host session declares it wants. |

***

### KernelLogger

Minimal diagnostic logger surface a kernel can inject into services.

Services treat it as an optional sink: the kernel supplies it during boot,
but standalone construction (tests, adapters) may omit it.

#### Methods

##### warn()

```ts
warn(message, meta?): void;
```

Emits a structured, non-fatal diagnostic warning.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `meta?` | `Record`\<`string`, `unknown`\> |

###### Returns

`void`

***

### KernelObservation

One record on the kernel's observation stream.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-at"></a> `at` | `readonly` | `number` | Milliseconds since the epoch at which the record was made. |
| <a id="property-detail"></a> `detail` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Detailed, structured reason. Never returned to the refused caller. |
| <a id="property-event"></a> `event` | `readonly` | `string` | Stable event name. |
| <a id="property-source"></a> `source` | `readonly` | `string` | Kernel component or root primitive that made the record. |

***

### KindDeclaration

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-description-3"></a> `description?` | `readonly` | `string` | Public description of the kind. |
| <a id="property-exposure-1"></a> `exposure` | `readonly` | `string` | The participant's own exposure name that dispatches the kind. |
| <a id="property-kind"></a> `kind` | `readonly` | `string` | The kind word written after `[CALL`, e.g. `tool`. |
| <a id="property-operations-1"></a> `operations` | `readonly` | `"open"` \| `Readonly`\<`Record`\<`string`, `KindOperationDescription`\>\> | Every operation the kind serves, by name. Required: the kernel refuses an operation that is not listed, before the owner is reached. `'open'` declares that the owner defines the operation names itself (for example from a registry filled at runtime), so the kernel cannot list them. It must be written out, and the kind's `permission` is then required and is enforced on every call; the owner decides which names exist. |
| <a id="property-permission"></a> `permission?` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Default permission for operations that declare none; required when `operations` is `'open'`. |
| <a id="property-version-4"></a> `version?` | `readonly` | `string` \| `number` | Major version of the exposure; defaults to 1. |

***

### OperationHandler

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-tinput-3"></a> `TInput` | `unknown` |
| <a id="type-parameter-toutput-3"></a> `TOutput` | `unknown` |

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-kind-1"></a> `kind` | `readonly` | `string` |
| <a id="property-metadata-1"></a> `metadata?` | `readonly` | [`PluginMetadata`](#pluginmetadata) |
| <a id="property-promptdescriptor"></a> `promptDescriptor?` | `readonly` | [`PromptDescriptor`](#promptdescriptor) |
| <a id="property-requiredcapabilities"></a> `requiredCapabilities?` | `readonly` | readonly [`Token`](#token)\<`unknown`\>[] |

#### Methods

##### execute()

```ts
execute(context, input): Promise<OperationResult<TOutput>>;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `context` | [`ExecutionContext`](#executioncontext) |
| `input` | `TInput` |

###### Returns

`Promise`\<[`OperationResult`](#operationresult)\<`TOutput`\>\>

***

### OperationResult

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-tdata"></a> `TData` | `unknown` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-data"></a> `data?` | `TData` |
| <a id="property-durationms"></a> `durationMs?` | `number` |
| <a id="property-error"></a> `error?` | `string` \| `Error` |
| <a id="property-message"></a> `message?` | `string` |
| <a id="property-status"></a> `status` | `"skipped"` \| `"failed"` \| `"success"` \| `"aborted"` |

***

### ParticipantManifest

A participant's manifest.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-events-1"></a> `events?` | `readonly` | readonly [`EventDeclaration`](#eventdeclaration)[] | Events the participant declares. |
| <a id="property-exposures-1"></a> `exposures?` | `readonly` | readonly [`ExposureDeclaration`](#exposuredeclaration)[] | Exposures the participant gives. |
| <a id="property-interceptionpoints-1"></a> `interceptionPoints?` | `readonly` | readonly [`InterceptionPointDeclaration`](#interceptionpointdeclaration)[] | Interception points the participant opens on its own exposures. |
| <a id="property-interceptions-1"></a> `interceptions?` | `readonly` | readonly [`InterceptionDeclaration`](#interceptiondeclaration)[] | Interceptions the participant asks for. |
| <a id="property-kinds-1"></a> `kinds?` | `readonly` | readonly [`KindDeclaration`](#kinddeclaration)[] | - |
| <a id="property-requests"></a> `requests?` | `readonly` | [`ParticipantRequests`](#participantrequests) | What the participant requests. |

***

### ParticipantRequests

What a participant requests. A request is not a grant; the giver decides.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-capabilities-3"></a> `capabilities?` | `readonly` | readonly `string`[] | Capability tokens the participant asks for. |

***

### PluginMetadata

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-author"></a> `author?` | `readonly` | `string` |
| <a id="property-isofficial"></a> `isOfficial?` | `readonly` | `boolean` |
| <a id="property-permissions"></a> `permissions?` | `readonly` | readonly `string`[] |
| <a id="property-version-5"></a> `version?` | `readonly` | `string` |

***

### PromptDescriptor

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-description-4"></a> `description` | `readonly` | `string` |
| <a id="property-examples"></a> `examples?` | `readonly` | readonly `string`[] |
| <a id="property-syntaxguide"></a> `syntaxGuide?` | `readonly` | `string` |
| <a id="property-systempromptfragment"></a> `systemPromptFragment?` | `readonly` | `string` |

***

### ServiceAccessPolicy

Declarative access control rules applied when a caller requests a service.

A denied caller is always rejected. When `allowedCallers` is provided, only
the listed callers may access the service; otherwise access is open.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-allowedcallers"></a> `allowedCallers?` | `readonly` | readonly (`string` \| [`ServiceToken`](#servicetoken)\<`unknown`\>)[] | Callers explicitly permitted to access the service. |
| <a id="property-deniedcallers"></a> `deniedCallers?` | `readonly` | readonly (`string` \| [`ServiceToken`](#servicetoken)\<`unknown`\>)[] | Callers that can never access the service. |

***

### ServiceContext

Ambient context supplied to a service at construction and access time.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-callerid"></a> `callerId` | `readonly` | `string` | Identifier of the caller or service this context describes. |
| <a id="property-logger-1"></a> `logger?` | `readonly` | [`KernelLogger`](#kernellogger) | Kernel diagnostic sink. Absent in standalone construction. |
| <a id="property-options-2"></a> `options` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Opaque host-supplied options bag. The kernel stores the bag at boot and attaches it unchanged to every service context. The core never inspects a key; services read the options their own domain owns. |
| <a id="property-tier"></a> `tier` | `readonly` | [`ServiceTier`](#servicetier) | Privilege tier of the caller. |

***

### ServiceContractDeclaration

Contract a service descriptor declares for its public interface.

The declaration is descriptive: it names the version and the methods the
service promises. The kernel only compares it against hardcore requirements;
it does not interpret any method.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-methods"></a> `methods` | `readonly` | readonly `string`[] | Method names the service implements for this contract. |
| <a id="property-version-6"></a> `version` | `readonly` | `string` | Contract version the service implements. |

***

### ServiceDescriptor

Self-describing registration record for a kernel service.

The factory may build a richer internal shape `TInternal`, while `project`
narrows that instance to the public `TService` interface for each caller.

#### Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| <a id="type-parameter-tservice-3"></a> `TService` | - | The public interface exposed to callers. |
| <a id="type-parameter-tinternal"></a> `TInternal` *extends* `TService` | `TService` | The internal instance type, which must extend `TService`. |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-accesspolicy"></a> `accessPolicy?` | `readonly` | [`ServiceAccessPolicy`](#serviceaccesspolicy) | Access control rules applied to every request. |
| <a id="property-contract"></a> `contract?` | `readonly` | [`ServiceContractDeclaration`](#servicecontractdeclaration) | Declared contract for the public service interface. Optional for ordinary services. The kernel's fixed hardcore list requires a declared contract on the services it names. |
| <a id="property-dependencies"></a> `dependencies` | `readonly` | readonly [`ServiceToken`](#servicetoken)\<`unknown`\>[] | Services that must be registered and initialized before this one. |
| <a id="property-factory"></a> `factory` | `readonly` | (`context`, `broker`) => `TInternal` & [`IServiceLifecycle`](#iservicelifecycle) | Builds the service instance. |
| <a id="property-manifest"></a> `manifest?` | `readonly` | [`ParticipantManifest`](#participantmanifest) | Declarative manifest: what the participant requests and which exposures it gives, with their scopes and policies. Data only. The kernel admits it at boot without invoking [factory](#property-factory). |
| <a id="property-project"></a> `project?` | `readonly` | (`instance`, `caller`) => `TService` | Projects the internal instance into the caller-facing interface. Defaults to returning the instance unchanged when omitted. |
| <a id="property-tier-1"></a> `tier` | `readonly` | [`ServiceTier`](#servicetier) | Privilege tier the service belongs to. |
| <a id="property-token"></a> `token` | `readonly` | [`ServiceToken`](#servicetoken)\<`TService`\> | Token identifying the service. |

***

### ServiceInfo

Read-only metadata describing a registered service.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-description-5"></a> `description` | `readonly` | `string` | Short explanation of what the service provides. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Stable identifier of the service. |
| <a id="property-initialized"></a> `initialized` | `readonly` | `boolean` | Whether the service has completed initialization. |
| <a id="property-tier-2"></a> `tier` | `readonly` | [`ServiceTier`](#servicetier) | Privilege tier the service belongs to. |

***

### ServiceToken

A phantom-branded capability token identifying a service within the kernel.

The brand is represented by a tuple so the wrapped service interface is
preserved invariantly. Consumers must never read `_brand` at runtime; it
exists purely to carry `TService` through registration and lookup.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-tservice-4"></a> `TService` | The public interface exposed by the service. |

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-_brand"></a> `_brand` | `readonly` | readonly \[`TService`\] | Phantom brand preserving `TService` for strict type inference. |
| <a id="property-description-6"></a> `description` | `readonly` | `string` | Short explanation of what the service provides. |
| <a id="property-id-1"></a> `id` | `readonly` | `string` | Stable, human-readable identifier used for diagnostics and policies. |

## Type Aliases

### BrudOperationKind

```ts
type BrudOperationKind = string;
```

Open operation-kind identity.

***

### CallerClass

```ts
type CallerClass = typeof CALLER_CLASSES[number];
```

Identity class of a caller.

`kernel` is the kernel itself, `participant` is a participant admitted to
the composition, and `host` is a host session.

***

### CallOrigin

```ts
type CallOrigin = typeof CALL_ORIGINS[number];
```

Root origin of a call chain.

`kernel` is a chain the kernel itself starts for its own work. `runtime` is a
chain the kernel starts when it runs a participant inside the runtime.
`host` is a chain the host starts from its authenticated session through the
kernel's host entry point.

***

### CapabilityToken

```ts
type CapabilityToken = string;
```

Open capability token.

***

### ContextContractErrorCode

```ts
type ContextContractErrorCode = "CONTEXT_CONTRACT_VIOLATION";
```

Stable failure code for every contract violation.

***

### ContextFieldType

```ts
type ContextFieldType = typeof CONTEXT_FIELD_TYPES[number];
```

A supported context field type.

***

### InferService

```ts
type InferService<TToken> = TToken extends ServiceToken<infer TService> ? TService : never;
```

Extracts the public service interface carried by a service token.

Planned: this is a universal type-level helper with no current consumer. It
is retained deliberately as part of the token primitive.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-ttoken"></a> `TToken` | A [ServiceToken](#servicetoken) type. |

***

### Middleware

```ts
type Middleware = (context, input, next) => Promise<OperationResult>;
```

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `context` | [`ExecutionContext`](#executioncontext) |
| `input` | `unknown` |
| `next` | [`MiddlewareNext`](#middlewarenext) |

#### Returns

`Promise`\<[`OperationResult`](#operationresult)\>

***

### MiddlewareNext

```ts
type MiddlewareNext = () => Promise<OperationResult>;
```

#### Returns

`Promise`\<[`OperationResult`](#operationresult)\>

***

### ServiceTier

```ts
type ServiceTier = "kernel" | "core" | "userland";
```

Privilege tier a service belongs to, ordered from most to least trusted.

***

### Token

```ts
type Token<T> = symbol & object;
```

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-9"></a> `T` |

#### Type Declaration

##### \_\_brand

```ts
__brand: T;
```

## Variables

### BRUD\_KIND\_PATTERN

```ts
const BRUD_KIND_PATTERN: RegExp;
```

Safe kind token: starts with a letter, then letters, digits, `_` or `-`.

***

### CALL\_ORIGINS

```ts
const CALL_ORIGINS: readonly ["kernel", "runtime", "host"];
```

Root origins a call chain can carry.

***

### CALLER\_CLASSES

```ts
const CALLER_CLASSES: readonly ["kernel", "participant", "host"];
```

Identity classes a caller can belong to.

***

### CAPABILITY\_TOKEN\_PATTERN

```ts
const CAPABILITY_TOKEN_PATTERN: RegExp;
```

Shape accepted for capability tokens.

Lowercase-only keeps diagnostics and manifest comparisons deterministic.

***

### CONTEXT\_FIELD\_TYPES

```ts
const CONTEXT_FIELD_TYPES: readonly ["string", "number", "boolean", "object"];
```

Primitive types the contract understands.

***

### DEFAULT\_KERNEL\_CALL\_LIMITS

```ts
const DEFAULT_KERNEL_CALL_LIMITS: KernelCallLimits;
```

Limits used when the host does not supply its own.

## Functions

### admitParticipantManifest()

```ts
function admitParticipantManifest(participant, manifest): AdmittedManifest;
```

Validates and freezes a participant's manifest.

Fails closed: an unknown field, a non-data value, or a malformed shape refuses
the manifest. An absent manifest admits no requests and no exposures.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `participant` | `string` | Token id of the participant, used in diagnostics. |
| `manifest` | `unknown` | The declared manifest, or `undefined`. |

#### Returns

[`AdmittedManifest`](#admittedmanifest)

***

### createServiceToken()

```ts
function createServiceToken<TService>(id, description?): ServiceToken<TService>;
```

Creates a service token for the given identifier and description.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-tservice-5"></a> `TService` | The public interface exposed by the service. |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `id` | `string` | Stable identifier for the service. |
| `description?` | `string` | Short explanation of what the service provides. When omitted, a description is derived from the identifier. |

#### Returns

[`ServiceToken`](#servicetoken)\<`TService`\>

A phantom-branded token bound to `TService`.

***

### createToken()

```ts
function createToken<T>(description): Token<T>;
```

Planned: the token-keyed container is a universal kernel primitive. It is
constructed and consulted by the dispatch pipeline; no production module
registers into it yet.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-10"></a> `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `description` | `string` |

#### Returns

[`Token`](#token)\<`T`\>

***

### isCapabilityToken()

```ts
function isCapabilityToken(value): value is string;
```

Validates a declarable capability token.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Untrusted capability. |

#### Returns

`value is string`

`true` when the value has the accepted capability shape.

***

### isValidBrudKind()

```ts
function isValidBrudKind(value): boolean;
```

Validates an untrusted kind token.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `string` | Candidate kind. |

#### Returns

`boolean`

`true` when the token is safe to register and route.

***

### requireContextString()

```ts
function requireContextString(
   options, 
   field, 
   service
): string;
```

Reads a required non-empty string field from an options bag.

The field name is supplied by the service; the core does not know any
concrete field. This is the descriptor-level read used after contract
validation, and it also protects standalone descriptor construction.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Opaque options bag. |
| `field` | `string` | Dotted field name owned by the calling service. |
| `service` | `string` | Service id used in the error. |

#### Returns

`string`

The string value.

#### Throws

When the value is absent or not a non-empty
string.

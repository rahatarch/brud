[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/IdentityRegistry/contracts

# Identity Registry (hardcore 1)

## Classes

### IdentityRegistryCorruptError

Raised at boot when the registry storage exists but fails parsing or
integrity validation.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryCorruptError(storagePath, reason): IdentityRegistryCorruptError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |
| `reason` | `string` |

###### Returns

[`IdentityRegistryCorruptError`](#identityregistrycorrupterror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_CORRUPT";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### reason

```ts
readonly reason: string;
```

Scrubbed reason for the failure. Never includes raw storage content.

##### storagePath

```ts
readonly storagePath: string;
```

Absolute storage path that failed validation.

***

### `abstract` IdentityRegistryError

Base class for every identity registry domain failure.

#### Extends

- `Error`

#### Extended by

- [`IdentityRegistryCorruptError`](#identityregistrycorrupterror)
- [`IdentityRegistryFrozenError`](#identityregistryfrozenerror)
- [`IdentityRegistryInputError`](#identityregistryinputerror)
- [`IdentityRegistryMissingError`](#identityregistrymissingerror)
- [`IdentityRegistryNotReadyError`](#identityregistrynotreadyerror)
- [`IdentityRegistryPathError`](#identityregistrypatherror)
- [`IdentityRegistryRevokedError`](#identityregistryrevokederror)
- [`IdentityRegistryStorageExistsError`](#identityregistrystorageexistserror)
- [`IdentityRegistryUnknownTokenError`](#identityregistryunknowntokenerror)
- [`IdentityRegistryWriteError`](#identityregistrywriteerror)

#### Constructors

##### Constructor

```ts
protected new IdentityRegistryError(message): IdentityRegistryError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |

###### Returns

[`IdentityRegistryError`](#abstract-identityregistryerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: IdentityRegistryErrorCode;
```

Stable, machine-readable failure code.

***

### IdentityRegistryFrozenError

Raised when an operation attempts to mutate a frozen registry.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryFrozenError(operation): IdentityRegistryFrozenError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `operation` | `string` |

###### Returns

[`IdentityRegistryFrozenError`](#identityregistryfrozenerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_FROZEN";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### operation

```ts
readonly operation: string;
```

Operation that was refused.

***

### IdentityRegistryInputError

Raised when an operation receives an invalid opaque value.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryInputError(field, reason): IdentityRegistryInputError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `string` |
| `reason` | `string` |

###### Returns

[`IdentityRegistryInputError`](#identityregistryinputerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_INPUT_INVALID";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### field

```ts
readonly field: string;
```

Field or operation that failed validation.

***

### IdentityRegistryMissingError

Raised at boot when the configured registry storage file does not exist.

The service refuses to regenerate a missing registry because a silent reset
would turn an integrity failure into an identity reset.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryMissingError(storagePath): IdentityRegistryMissingError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |

###### Returns

[`IdentityRegistryMissingError`](#identityregistrymissingerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_MISSING";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### storagePath

```ts
readonly storagePath: string;
```

Absolute storage path the service expected.

***

### IdentityRegistryNotReadyError

Raised when an operation is attempted before the registry loaded.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryNotReadyError(operation): IdentityRegistryNotReadyError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `operation` | `string` |

###### Returns

[`IdentityRegistryNotReadyError`](#identityregistrynotreadyerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_NOT_READY";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### operation

```ts
readonly operation: string;
```

Operation that was refused.

***

### IdentityRegistryPathError

Raised when a storage path is not an absolute file path.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryPathError(storagePath): IdentityRegistryPathError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |

###### Returns

[`IdentityRegistryPathError`](#identityregistrypatherror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_PATH_INVALID";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### storagePath

```ts
readonly storagePath: string;
```

Rejected path value.

***

### IdentityRegistryRevokedError

Raised when a revoked token or binding is used again.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryRevokedError(token): IdentityRegistryRevokedError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | `string` |

###### Returns

[`IdentityRegistryRevokedError`](#identityregistryrevokederror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_REVOKED";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### token

```ts
readonly token: string;
```

Token whose binding is permanently revoked.

***

### IdentityRegistryStorageExistsError

Raised when operator provisioning would overwrite an existing registry.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryStorageExistsError(storagePath): IdentityRegistryStorageExistsError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |

###### Returns

[`IdentityRegistryStorageExistsError`](#identityregistrystorageexistserror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_STORAGE_EXISTS";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### storagePath

```ts
readonly storagePath: string;
```

Existing storage path.

***

### IdentityRegistryUnknownTokenError

Raised when a retire or revoke names a token that is not recorded.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryUnknownTokenError(token): IdentityRegistryUnknownTokenError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | `string` |

###### Returns

[`IdentityRegistryUnknownTokenError`](#identityregistryunknowntokenerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_UNKNOWN_TOKEN";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### token

```ts
readonly token: string;
```

Token value that was not found.

***

### IdentityRegistryWriteError

Raised when the registry cannot write its storage file.

#### Extends

- [`IdentityRegistryError`](#abstract-identityregistryerror)

#### Constructors

##### Constructor

```ts
new IdentityRegistryWriteError(storagePath, reason): IdentityRegistryWriteError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `storagePath` | `string` |
| `reason` | `string` |

###### Returns

[`IdentityRegistryWriteError`](#identityregistrywriteerror)

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "IDENTITY_REGISTRY_WRITE_FAILED";
```

Stable, machine-readable failure code.

###### Overrides

[`IdentityRegistryError`](#abstract-identityregistryerror).[`code`](#code-1)

##### storagePath

```ts
readonly storagePath: string;
```

Storage path the write targeted.

## Interfaces

### IdentityBinding

Opaque values the boot-time issuer records against a token.

#### Extended by

- [`IdentityRecord`](#identityrecord)

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-contenthash"></a> `contentHash` | `readonly` | `string` | Opaque content hash. Never verified or interpreted here. |
| <a id="property-metadata"></a> `metadata` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Opaque JSON metadata record. |
| <a id="property-publisher"></a> `publisher` | `readonly` | `string` | Opaque publisher identifier. Never verified or interpreted here. |

***

### IdentityRecord

A token together with the binding it was issued for.

#### Extends

- [`IdentityBinding`](#identitybinding)

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-contenthash-1"></a> `contentHash` | `readonly` | `string` | Opaque content hash. Never verified or interpreted here. | [`IdentityBinding`](#identitybinding).[`contentHash`](#property-contenthash) |
| <a id="property-metadata-1"></a> `metadata` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Opaque JSON metadata record. | [`IdentityBinding`](#identitybinding).[`metadata`](#property-metadata) |
| <a id="property-publisher-1"></a> `publisher` | `readonly` | `string` | Opaque publisher identifier. Never verified or interpreted here. | [`IdentityBinding`](#identitybinding).[`publisher`](#property-publisher) |
| <a id="property-state"></a> `state` | `readonly` | `"active"` \| `"retired"` \| `"revoked"` | Current lifecycle state. | - |
| <a id="property-token"></a> `token` | `readonly` | `string` | Registry-issued opaque token. | - |

***

### IIdentityRegistry

Identity registry contract.

The four operations are the only mutation and read paths. `issue`, `retire`,
and `revoke` are available only during the boot window; the service freezes
itself when the kernel reaches `RUNNING`. `resolve` remains available.

#### Methods

##### issue()

```ts
issue(binding): IdentityRecord;
```

Issues a token for an opaque binding, or returns the existing one.

The same publisher and content hash always return the same token. A
retired binding is reclaimed by reactivating its token. A revoked binding
is never reissued.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `binding` | [`IdentityBinding`](#identitybinding) | Opaque publisher, content hash, and metadata. |

###### Returns

[`IdentityRecord`](#identityrecord)

The active record for the binding.

##### resolve()

```ts
resolve(token): IdentityRecord | null;
```

Resolves a token to its recorded binding.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Opaque token value. |

###### Returns

[`IdentityRecord`](#identityrecord) \| `null`

The recorded binding, including its lifecycle state, or `null`
when the token is unknown.

##### retire()

```ts
retire(token): IdentityRecord;
```

Marks a token inactive while preserving its record.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Opaque token value. |

###### Returns

[`IdentityRecord`](#identityrecord)

The retired record.

##### revoke()

```ts
revoke(token): IdentityRecord;
```

Revokes a token permanently. A revoked binding is never reissued.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Opaque token value. |

###### Returns

[`IdentityRecord`](#identityrecord)

The revoked record.

## Type Aliases

### IdentityRegistryErrorCode

```ts
type IdentityRegistryErrorCode = 
  | "IDENTITY_REGISTRY_MISSING"
  | "IDENTITY_REGISTRY_CORRUPT"
  | "IDENTITY_REGISTRY_FROZEN"
  | "IDENTITY_REGISTRY_UNKNOWN_TOKEN"
  | "IDENTITY_REGISTRY_REVOKED"
  | "IDENTITY_REGISTRY_INPUT_INVALID"
  | "IDENTITY_REGISTRY_NOT_READY"
  | "IDENTITY_REGISTRY_STORAGE_EXISTS"
  | "IDENTITY_REGISTRY_PATH_INVALID"
  | "IDENTITY_REGISTRY_WRITE_FAILED";
```

Stable, machine-readable identity registry failure codes.

***

### IdentityState

```ts
type IdentityState = typeof IDENTITY_STATES[number];
```

Lifecycle state of one recorded identity.

***

### IdentityToken

```ts
type IdentityToken = string;
```

Opaque token issued by the registry. It is not a credential.

## Variables

### IDENTITY\_STATES

```ts
const IDENTITY_STATES: readonly ["active", "retired", "revoked"];
```

Lifecycle state of one recorded identity.

***

### IdentityRegistryToken

```ts
const IdentityRegistryToken: ServiceToken<IIdentityRegistry>;
```

Kernel service token for the identity registry.

The identifier is stable and namespaced under the kernel's core tier. It is
not an identity token; it resolves the registry service itself.

## Functions

### isIdentityState()

```ts
function isIdentityState(value): value is "active" | "retired" | "revoked";
```

Reports whether a value is a supported identity state.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | Candidate value. |

#### Returns

value is "active" \| "retired" \| "revoked"

[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/Events/contracts

# Events (hardcore 6)

## Classes

### EventDuplicateDeclarationError

Raised when the same (name, major) event is declared twice.

#### Extends

- [`EventError`](#abstract-eventerror)

#### Constructors

##### Constructor

```ts
new EventDuplicateDeclarationError(eventName, major): EventDuplicateDeclarationError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` |
| `major` | `number` |

###### Returns

[`EventDuplicateDeclarationError`](#eventduplicatedeclarationerror)

###### Overrides

[`EventError`](#abstract-eventerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "EVENTS_DUPLICATE_DECLARATION";
```

Stable, machine-readable error code.

###### Overrides

[`EventError`](#abstract-eventerror).[`code`](#code-1)

##### eventName

```ts
readonly eventName: string;
```

Duplicated event name.

##### major

```ts
readonly major: number;
```

Duplicated major version.

***

### `abstract` EventError

Base class for every events-catalogue domain failure.

#### Extends

- `Error`

#### Extended by

- [`EventNameCollisionError`](#eventnamecollisionerror)
- [`EventDuplicateDeclarationError`](#eventduplicatedeclarationerror)

#### Constructors

##### Constructor

```ts
protected new EventError(message, options?): EventError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`EventError`](#abstract-eventerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: EventErrorCode;
```

Stable, machine-readable error code.

***

### EventNameCollisionError

Raised when a second identity declares an event name another identity owns.

A name is owned by the identity that first declared it, across every major
version: a version upgrade keeps ownership.

#### Extends

- [`EventError`](#abstract-eventerror)

#### Constructors

##### Constructor

```ts
new EventNameCollisionError(eventName, owner): EventNameCollisionError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` |
| `owner` | `string` |

###### Returns

[`EventNameCollisionError`](#eventnamecollisionerror)

###### Overrides

[`EventError`](#abstract-eventerror).[`constructor`](#constructor-1)

#### Properties

##### code

```ts
readonly code: "EVENTS_NAME_COLLISION";
```

Stable, machine-readable error code.

###### Overrides

[`EventError`](#abstract-eventerror).[`code`](#code-1)

##### eventName

```ts
readonly eventName: string;
```

Contested event name.

##### owner

```ts
readonly owner: string;
```

Identity token that owns the name.

## Interfaces

### EventDeliveryRecord

One plain delivery.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-emitorigin"></a> `emitOrigin` | `readonly` | `string` |
| <a id="property-emitteridentity"></a> `emitterIdentity` | `readonly` | `string` \| `null` |
| <a id="property-eventname"></a> `eventName` | `readonly` | `string` |
| <a id="property-eventversion"></a> `eventVersion` | `readonly` | `number` |
| <a id="property-payload"></a> `payload` | `readonly` | `unknown` |
| <a id="property-sequence"></a> `sequence` | `readonly` | `number` |

***

### EventsPullOptions

Options a subscriber passes to `pull`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-lastsequence"></a> `lastSequence?` | `readonly` | `number` | Reconnect: return the retained emits after this sequence. |
| <a id="property-maxbatch"></a> `maxBatch?` | `readonly` | `number` | Batch bound, capped by the hardcore's batch size. |

***

### EventsRefusal

A reason-carrying refusal, distinguishable from an empty batch.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-detail"></a> `detail?` | `readonly` | `string` |
| <a id="property-reason"></a> `reason` | `readonly` | `"closed"` \| `"unknown-subscription"` \| `"not-subscriber"` |
| <a id="property-refused"></a> `refused` | `readonly` | `true` |

***

### EventsSubscribeOptions

Options a subscriber passes to `subscribe`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-lastsequence-1"></a> `lastSequence?` | `readonly` | `number` | Last sequence already seen; the subscription starts after it. |
| <a id="property-policy"></a> `policy?` | `readonly` | [`EventsBackpressurePolicy`](#eventsbackpressurepolicy) | Backpressure policy; defaults to `drop-oldest`. |
| <a id="property-subscriber"></a> `subscriber?` | `readonly` | [`ExposedApiCaller`](../ExposedApiRegistry/contracts.md#exposedapicaller) | The end subscriber's caller view, forwarded by the event's owner when its subscription API creates the subscription on a subscriber's behalf. Honoured only when the resolver of `events.subscribe` is the event's owner. |

***

### IEventsService

#### Methods

##### close()

```ts
close(subscriptionId): EventsRefusal | undefined;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `subscriptionId` | `string` |

###### Returns

[`EventsRefusal`](#eventsrefusal) \| `undefined`

##### emit()

```ts
emit(name, payload): EventsEmitResult;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `payload` | `unknown` |

###### Returns

[`EventsEmitResult`](#eventsemitresult)

##### list()

```ts
list(): readonly string[];
```

###### Returns

readonly `string`[]

##### pull()

```ts
pull(subscriptionId, options?): 
  | EventsRefusal
  | readonly EventDeliveryRecord[];
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `subscriptionId` | `string` |
| `options?` | [`EventsPullOptions`](#eventspulloptions) |

###### Returns

  \| [`EventsRefusal`](#eventsrefusal)
  \| readonly [`EventDeliveryRecord`](#eventdeliveryrecord)[]

##### subscribe()

```ts
subscribe(eventName, options?): string | null;
```

Creates a subscription to the highest declared major of `eventName`.
Returns the subscription identity the events hardcore assigns, or the
uniform `null` (E-08).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventName` | `string` |
| `options?` | [`EventsSubscribeOptions`](#eventssubscribeoptions) |

###### Returns

`string` \| `null`

## Type Aliases

### EventErrorCode

```ts
type EventErrorCode = "EVENTS_NAME_COLLISION" | "EVENTS_DUPLICATE_DECLARATION";
```

Stable, machine-readable codes for events-catalogue failures.

***

### EventsBackpressurePolicy

```ts
type EventsBackpressurePolicy = "drop-oldest" | "refuse-emit" | "drop-newest";
```

Backpressure a subscriber declares at subscribe time; enforced at emit.

***

### EventsEmitResult

```ts
type EventsEmitResult = 
  | {
  ok: true;
  refusedSubscriptions: readonly string[];
  sequence: number;
}
  | {
  detail: string;
  ok: false;
  reason: "malformed" | "refused";
};
```

The emit outcome. An accepted emit carries its sequence and the
subscriptions whose `refuse-emit` queue refused their copy; a refused emit
consumes no sequence.

## Variables

### EventsToken

```ts
const EventsToken: ServiceToken<IEventsService>;
```

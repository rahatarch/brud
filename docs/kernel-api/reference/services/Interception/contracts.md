[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/Interception/contracts

# Interception (hardcore 7)

## Classes

### InterceptionBlockedError

Thrown by a giver when the interception outcome blocks the call.

#### Extends

- [`InterceptionError`](#abstract-interceptionerror)

#### Constructors

##### Constructor

```ts
new InterceptionBlockedError(
   target, 
   reason, 
   interceptor?
): InterceptionBlockedError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `target` | `string` |
| `reason` | `string` |
| `interceptor?` | `string` |

###### Returns

[`InterceptionBlockedError`](#interceptionblockederror)

###### Overrides

[`InterceptionError`](#abstract-interceptionerror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "INTERCEPTION_BLOCKED";
```

Stable, machine-readable error code.

###### Overrides

[`InterceptionError`](#abstract-interceptionerror).[`code`](#code-2)

##### interceptor

```ts
readonly interceptor: string | undefined;
```

Service token of the blocking interceptor, when one blocked.

##### reason

```ts
readonly reason: string;
```

The blocking reason.

##### target

```ts
readonly target: string;
```

The interception point, `name@major`.

***

### InterceptionDeclarationError

Raised at boot when an interception or an interception point is not admissible.

#### Extends

- [`InterceptionError`](#abstract-interceptionerror)

#### Constructors

##### Constructor

```ts
new InterceptionDeclarationError(participant, reason): InterceptionDeclarationError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `participant` | `string` |
| `reason` | `string` |

###### Returns

[`InterceptionDeclarationError`](#interceptiondeclarationerror)

###### Overrides

[`InterceptionError`](#abstract-interceptionerror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "INTERCEPTION_DECLARATION_INVALID";
```

Stable, machine-readable error code.

###### Overrides

[`InterceptionError`](#abstract-interceptionerror).[`code`](#code-2)

##### participant

```ts
readonly participant: string;
```

Service token of the declaring participant.

***

### `abstract` InterceptionError

Base class for every interception domain failure.

#### Extends

- `Error`

#### Extended by

- [`InterceptionDeclarationError`](#interceptiondeclarationerror)
- [`InterceptionBlockedError`](#interceptionblockederror)

#### Constructors

##### Constructor

```ts
protected new InterceptionError(message, options?): InterceptionError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`InterceptionError`](#abstract-interceptionerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: InterceptionErrorCode;
```

Stable, machine-readable error code.

## Interfaces

### IInterceptionService

#### Methods

##### evaluate()

```ts
evaluate(
   target, 
   method, 
   args, 
   options?
): InterceptionOutcome;
```

Runs the admitted interceptors of the giver's interception point, in the
giver's order. Only the point's owner may evaluate it.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `target` | `string` |
| `method` | `string` |
| `args` | readonly `unknown`[] |
| `options?` | [`InterceptionEvaluateOptions`](#interceptionevaluateoptions) |

###### Returns

[`InterceptionOutcome`](#interceptionoutcome)

##### evaluateResult()

```ts
evaluateResult(
   target, 
   method, 
   args, 
   result, 
   options?
): InterceptionResultOutcome;
```

Runs the output stage of the giver's interception point on the result the
giver produced: each interceptor that declared the output stage may append
content, in the giver's order. The result is never changed. Only the
point's owner may evaluate it, and `args` are the final arguments of the
call (after any input modification). The result must be plain JSON.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `target` | `string` |
| `method` | `string` |
| `args` | readonly `unknown`[] |
| `result` | `unknown` |
| `options?` | [`InterceptionEvaluateOptions`](#interceptionevaluateoptions) |

###### Returns

[`InterceptionResultOutcome`](#interceptionresultoutcome)

##### list()

```ts
list(): readonly string[];
```

The interception points in this composition, as `name@major`.

###### Returns

readonly `string`[]

***

### IInterceptor

What a giver implements on its instance to be called by the interception
hardcore. A non-enumerable method, like `provideExposure`: it is reached only
through the hardcore (`instanceOf` + `runAs`), never through `resolve`.

#### Methods

##### intercept()

```ts
intercept(call): InterceptionVerdict;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `call` | [`InterceptedCall`](#interceptedcall) |

###### Returns

[`InterceptionVerdict`](#interceptionverdict)

***

### InterceptedCall

The plain, frozen record of one intercepted call.

#### Extended by

- [`InterceptedResult`](#interceptedresult)

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-args"></a> `args` | `readonly` | readonly `unknown`[] | The call's arguments (plain JSON values). |
| <a id="property-caller"></a> `caller` | `readonly` | [`InterceptedCaller`](#interceptedcaller) | The original caller of the giver's exposure. |
| <a id="property-method"></a> `method` | `readonly` | `string` | The method of the target exposure being called. |
| <a id="property-target"></a> `target` | `readonly` | `string` | The interception point, `name@major`. |

***

### InterceptedCaller

The plain caller view an interceptor sees.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-callerclass"></a> `callerClass` | `readonly` | `string` |
| <a id="property-capabilities"></a> `capabilities` | `readonly` | `ReadonlySet`\<`string`\> |
| <a id="property-identity"></a> `identity` | `readonly` | `string` \| `null` |
| <a id="property-official"></a> `official` | `readonly` | `boolean` |
| <a id="property-origin"></a> `origin` | `readonly` | `string` |

***

### InterceptedResult

The intercepted call and the giver's result: plain, deep-frozen JSON.

#### Extends

- [`InterceptedCall`](#interceptedcall)

#### Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-args-1"></a> `args` | `readonly` | readonly `unknown`[] | The call's arguments (plain JSON values). | [`InterceptedCall`](#interceptedcall).[`args`](#property-args) |
| <a id="property-caller-1"></a> `caller` | `readonly` | [`InterceptedCaller`](#interceptedcaller) | The original caller of the giver's exposure. | [`InterceptedCall`](#interceptedcall).[`caller`](#property-caller) |
| <a id="property-method-1"></a> `method` | `readonly` | `string` | The method of the target exposure being called. | [`InterceptedCall`](#interceptedcall).[`method`](#property-method) |
| <a id="property-result"></a> `result` | `readonly` | `unknown` | What the giver returned. | - |
| <a id="property-target-1"></a> `target` | `readonly` | `string` | The interception point, `name@major`. | [`InterceptedCall`](#interceptedcall).[`target`](#property-target) |

***

### InterceptionAddition

One piece of content an interceptor appended, attributed to it.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `readonly` | `unknown` | The appended plain JSON content. |
| <a id="property-interceptor"></a> `interceptor` | `readonly` | `string` | Service token of the interceptor that appended it. |

***

### InterceptionEnvelope

What a caller of an intercepted exposure receives: the giver's result
exactly as returned, the additions in the order the interceptors ran, and
the interceptors that ran.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-additions"></a> `additions` | `readonly` | readonly [`InterceptionAddition`](#interceptionaddition)[] |
| <a id="property-interceptedby"></a> `interceptedBy` | `readonly` | readonly `string`[] |
| <a id="property-result-1"></a> `result` | `readonly` | `unknown` |

***

### InterceptionEvaluateOptions

Options the giver passes to `evaluate`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-caller-2"></a> `caller?` | `readonly` | [`ExposedApiCaller`](../ExposedApiRegistry/contracts.md#exposedapicaller) | The caller view the giver's projection received (delegation by the owner). |

***

### IResultInterceptor

What an interceptor implements on its instance to take part in the output
stage (non-enumerable, like `intercept`): reached only through the hardcore.

#### Methods

##### interceptResult()

```ts
interceptResult(call): InterceptionOutputVerdict;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `call` | [`InterceptedResult`](#interceptedresult) |

###### Returns

[`InterceptionOutputVerdict`](#interceptionoutputverdict)

## Type Aliases

### InterceptionErrorCode

```ts
type InterceptionErrorCode = "INTERCEPTION_DECLARATION_INVALID" | "INTERCEPTION_BLOCKED";
```

Stable, machine-readable codes for interception failures.

***

### InterceptionOutcome

```ts
type InterceptionOutcome = 
  | {
  allowed: true;
  args: readonly unknown[];
  modifiedBy: readonly string[];
}
  | {
  allowed: false;
  interceptor?: string;
  reason: string;
};
```

The combined outcome the giver enforces.

***

### InterceptionOutputVerdict

```ts
type InterceptionOutputVerdict = 
  | {
  verdict: "none";
}
  | {
  content: unknown;
  verdict: "append";
};
```

An output-stage verdict. An interceptor can only add: there is no way to
change, replace or remove the result, or to withhold it.

***

### InterceptionResultOutcome

```ts
type InterceptionResultOutcome = 
  | {
  applied: false;
}
  | {
  allowed: true;
  applied: true;
  envelope: InterceptionEnvelope;
}
  | {
  allowed: false;
  applied: true;
  interceptor?: string;
  reason: string;
};
```

The outcome of the output stage. `applied: false` means no admitted
interceptor takes part in it, so the giver returns its result as it always
did. `allowed: false` withholds the result.

***

### InterceptionStage

```ts
type InterceptionStage = "input" | "output";
```

A stage of interception.

***

### InterceptionVerdict

```ts
type InterceptionVerdict = 
  | {
  verdict: "allow";
}
  | {
  reason: string;
  verdict: "block";
}
  | {
  args: readonly unknown[];
  verdict: "modify";
};
```

An interceptor's verdict. `modify` replaces the call's arguments (same method,
same target); it cannot re-route the call.

## Variables

### INTERCEPTION\_OUTPUT\_CEILINGS

```ts
const INTERCEPTION_OUTPUT_CEILINGS: Readonly<{
  maxAdditionBytes: 65536;
  maxResultBytes: 1048576;
  maxTotalBytes: 262144;
}>;
```

Largest values the output stage allows, in bytes of canonical JSON. A point
may lower any of them with `outputLimits` and can never raise one.

***

### InterceptionToken

```ts
const InterceptionToken: ServiceToken<IInterceptionService>;
```

[**BrudOS Kernel API**](../../README.md)

***

[BrudOS Kernel API](../../README.md) / services/Parser/contracts

# Parser (hardcore 3)

## Classes

### OperationLimitExceededError

Raised when a document exceeds the configured operation bound.

#### Extends

- [`ParserError`](#abstract-parsererror)

#### Constructors

##### Constructor

```ts
new OperationLimitExceededError(observed, limit): OperationLimitExceededError;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `observed` | `number` | Operations found in the document. |
| `limit` | `number` | Configured maximum. |

###### Returns

[`OperationLimitExceededError`](#operationlimitexceedederror)

###### Overrides

[`ParserError`](#abstract-parsererror).[`constructor`](#constructor-2)

#### Properties

##### code

```ts
readonly code: "OPERATION_LIMIT_EXCEEDED";
```

###### Overrides

[`ParserError`](#abstract-parsererror).[`code`](#code-2)

##### limit

```ts
readonly limit: number;
```

Configured maximum.

##### observed

```ts
readonly observed: number;
```

Number of operations the document contained.

***

### ParserDisposedError

Raised when the parser is used after disposal.

#### Extends

- `Error`

#### Constructors

##### Constructor

```ts
new ParserDisposedError(): ParserDisposedError;
```

###### Returns

[`ParserDisposedError`](#parserdisposederror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
readonly code: "PARSER_DISPOSED";
```

***

### `abstract` ParserError

Base class for parser-domain failures other than structural parse errors.

#### Extends

- `Error`

#### Extended by

- [`OperationLimitExceededError`](#operationlimitexceedederror)

#### Constructors

##### Constructor

```ts
protected new ParserError(message, options?): ParserError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |
| `options?` | `ErrorOptions` |

###### Returns

[`ParserError`](#abstract-parsererror)

###### Overrides

`Error.constructor`

#### Properties

##### code

```ts
abstract readonly code: ParserErrorCode;
```

## Interfaces

### BrudOperation

One parsed `[BRUD]` operation.

This service knows only the wire syntax: an operation carries its
synthesized document index, the shared kind token, the name written on the
header, and the parameter map. It never resolves a target or a service.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-index"></a> `index` | `readonly` | `string` | 1-based document index synthesized from operation order. |
| <a id="property-kind"></a> `kind` | `readonly` | `string` | Shared operation kind, e.g. `tool` or `action`. |
| <a id="property-name"></a> `name` | `readonly` | `string` | Operation name written after the kind, e.g. `read_file`. |
| <a id="property-parameters"></a> `parameters` | `readonly` | `Readonly`\<`Record`\<`string`, `unknown`\>\> | Parsed payload. Protected regions are literal strings. |

***

### BrudParseFailure

Structured, fail-closed parse failure.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `readonly` | `string` | Stable machine-readable code. |
| <a id="property-details"></a> `details` | `readonly` | `string` | Diagnostic detail, including the document line when known. |
| <a id="property-friendly"></a> `friendly` | `readonly` | `string` | Human-readable summary. |
| <a id="property-line"></a> `line?` | `readonly` | `number` | Absolute 1-based document line, when the failure is positional. |

***

### BrudParseOptions

Bounds accepted by [IBrudParserService.parse](#parse).

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-maxoperations"></a> `maxOperations?` | `readonly` | `number` | Upper bound on parsed operations. Default 1_000. |

***

### IBrudParserService

Level-1 Brud Protocol v2 Parser.

Converts a raw `[BRUD]` document into an ordered list of internal
operations. The service is deliberately schema-agnostic and routing-agnostic:
it neither looks up a tool or action nor knows which service will consume
the result.

#### Methods

##### parse()

```ts
parse(rawInput, options?): BrudParseResult;
```

Scans a raw document into operations without dispatching anything.

The parser is fail-closed: a malformed document returns `ok: false` and no
partial operation list. Brace regions are captured literally.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `rawInput` | `string` | Raw model output, including any surrounding prose. |
| `options?` | [`BrudParseOptions`](#brudparseoptions) | Operation bound. |

###### Returns

[`BrudParseResult`](#brudparseresult)

## Type Aliases

### BrudParseResult

```ts
type BrudParseResult = 
  | {
  ok: true;
  operations: readonly BrudOperation[];
}
  | {
  error: BrudParseFailure;
  ok: false;
};
```

Result of a pure scan/parse.

***

### ParserErrorCode

```ts
type ParserErrorCode = "PARSER_DISPOSED" | "PARSE_ERROR" | "OPERATION_LIMIT_EXCEEDED";
```

Stable, machine-readable codes for Parser failures.

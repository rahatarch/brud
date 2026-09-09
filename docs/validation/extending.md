# Extending the Validation API

## Adding a New Validation Method

Validation methods are defined in the `BrudAPI.validate` object in `src/api/index.ts`.

### Steps

1. Add the method inside the `validate` object.
2. If the method needs an error, add or reuse a factory function from `errors.ts`.
3. Import any new error factory at the top of `index.ts`.

### Example: Adding a `validateMaxLength` Method

```typescript
// In src/api/index.ts — add inside validate { ... }
maxLength(value: string, max: number, fieldName: string): ValidationResult {
  if (value.length > max) {
    return fail(invalidFieldError(fieldName, `Value exceeds maximum length of ${max}`));
  }
  return success({ value, max });
}
```

### Rules

- Synchronous methods return `ValidationResult` directly.
- Asynchronous methods (those needing filesystem access) return `Promise<ValidationResult>` and accept a `FileSystem` parameter as the first argument.
- Use the `success(data?)` helper for passing results.
- Use the `fail(error)` helper for constructing failure results.
- Group synchronous and async methods logically within the `validate` object.

## Adding a New Error Factory Function

Error factories are defined in `src/api/errors.ts`.

### Steps

1. Add a new exported function in `errors.ts` that returns a `BrudError` object.
2. If the method will be used elsewhere, import and re-export it in `src/api/index.ts`.
3. Follow the existing naming convention: `camelCaseError()`.

### Example

```typescript
// In src/api/errors.ts
export function maxLengthError(field: string, max: number): BrudError {
  return {
    code: 'MAX_LENGTH_EXCEEDED',
    friendly: `Value for ${field} exceeds the maximum length of ${max}.`,
    details: `The value for "${field}" has too many characters. Maximum allowed is ${max}.`,
  };
}
```

```typescript
// In src/api/index.ts — add to the import block
import { maxLengthError } from './errors';

// Add to the export block
export { maxLengthError };
```

### Error Code Conventions

- Error codes use `SCREAMING_SNAKE_CASE`.
- Codes should be unique across all factory functions.
- The `friendly` field is intended for display to end users.
- The `details` field may contain technical information.
- Use the `path` field when the error references a file or directory.
- Use the `command` field when the error references a terminal command.

## Adding a New Dangerous Command Pattern

Dangerous patterns are stored in the `DANGEROUS_PATTERNS` array in `src/api/index.ts`.

### Steps

1. Identify the regex pattern for the dangerous command.
2. Add it to the `DANGEROUS_PATTERNS` array.
3. Add a corresponding test case in `terminal.test.ts`.

### Example

```typescript
// In src/api/index.ts — add to DANGEROUS_PATTERNS array
/\brm\s+--no-preserve-root\b/,
```

```typescript
// In src/validation/terminal.test.ts — add test case
it('catches "rm --no-preserve-root /"', () => {
  assert.strictEqual(isDangerousCommand('rm --no-preserve-root /'), true);
});
```

### Pattern Guidelines

- Use `\b` word boundaries to avoid matching substrings.
- Anchor patterns to prevent partial matches where possible.
- Test that safe variants of commands still pass.
- Common categories to consider: privilege escalation, data destruction, remote code execution, denial of service.
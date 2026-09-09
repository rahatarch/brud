# Validation API

## What It Is

The Validation API is a centralized set of validation methods exposed via `BrudAPI.validate` that all modules call before executing operations. Each method returns a `ValidationResult` indicating whether the operation should proceed.

## Why It Exists

- **Security**: Blocks dangerous terminal commands, restricts file operations to workspace boundaries, and prevents path traversal attacks.
- **Precondition Enforcement**: Ensures required fields exist, files are in the expected state, and operations are valid before execution.
- **Input Validation**: Verifies that user-provided values conform to expected formats, positions, modes, and known operation types.

## Core Concepts

| Concept | Description |
|---------|-------------|
| `ValidationResult` | Return type with `success: boolean`, optional `code`, `friendly`, `details`, and `data` fields |
| `BrudError` | Error class with `code`, `friendly`, `details`, `path`, and `command` fields |
| Error factories | Functions in `errors.ts` that construct `BrudError` objects for each failure scenario |
| Synchronous methods | Return `ValidationResult` immediately (workspace, path, command, field checks) |
| Asynchronous methods | Return `Promise<ValidationResult>` and require a `FileSystem` instance (file/directory existence, search) |

## Navigation

| Goal | File |
|------|------|
| See all 30 validation methods with signatures | [api-reference.md](api-reference.md) |
| View error codes, messages, and factory functions | [error-codes.md](error-codes.md) |
| Understand dangerous command patterns and security rules | [dangerous-commands.md](dangerous-commands.md) |
| Browse code examples for common validation patterns | [usage-examples.md](usage-examples.md) |
| Learn about test coverage and how to run tests | [testing.md](testing.md) |
| Add new validators, error codes, or dangerous patterns | [extending.md](extending.md) |
| Review edge cases and known behavioral quirks | [gotchas.md](gotchas.md) |
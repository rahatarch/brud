# Brud Code Central Validation API

## Overview

Brud Code uses a centralized validation API that all modules call before execution. This ensures consistent security checks, unified error messages, and a single point of patching for new validations.

## Core Principle

Validation is centralized. Execution is separated per module.

Modules send validation requests to the API before executing. The API validates and returns a decision. Modules handle execution based on the decision.

## Architecture

### Centralized (BrudAPI)

- Workspace validation
- Path validation
- Command validation
- Working directory validation
- File existence checks
- Security checks
- Error codes with friendly messages

### Separated (Per Module)

- Execution logic
- Result handling
- Module-specific behavior
- Error handling based on API decision

## API Interface

The API provides validation methods for every security check in Brud Code:

- validateWorkspace() — checks if workspace is open
- validatePath(path) — checks if path is within workspace
- validateCommand(command) — checks for dangerous patterns
- validateCwd(cwd) — checks working directory
- validateFileExists(path) — checks file existence
- And more as needed

## Error Response Format

Every validation returns:

{
  success: boolean,
  code: string (error code if failed),
  friendly: string (user-facing message),
  details: string (technical details)
}

## Usage Pattern

From any module:

const result = BrudAPI.validate.path(operation.path);
if (!result.success) {
  errors.push(result.error);
  return;
}
// Execute here

## Security Patching

When a new security threat is discovered:
1. Add validation method to the API
2. All modules calling that validation get the patch instantly
3. No need to update individual modules

## Error Codes

The API defines error codes for all known failure scenarios including:
- NO_WORKSPACE
- PATH_OUTSIDE_WORKSPACE
- FILE_NOT_FOUND
- DANGEROUS_COMMAND
- TERMINAL_TIMEOUT
- And 20+ more

## Integration Points

The API is used by:
- File operations engine
- Terminal executor
- Parsers
- All providers
- Future plugins

## Scaling

New validations are added as methods to the API. Existing modules automatically benefit. New modules call the API from day one.
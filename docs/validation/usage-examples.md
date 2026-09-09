# Usage Examples

## Validating a File Path

```typescript
import { BrudAPI } from '@brud/core';

const workspaceFolders = ['/home/user/project'];
const result = BrudAPI.validate.path('./src/index.ts', workspaceFolders);

if (result.success) {
  const data = result.data as { resolvedPath: string };
  console.log(data.resolvedPath);
  // '/home/user/project/src/index.ts'
} else {
  console.error(result.friendly);
  // 'The path is outside the current workspace.'
}
```

## Validating a Terminal Command

```typescript
import { BrudAPI } from '@brud/core';

// Dangerous command — blocked
const cmdResult = BrudAPI.validate.command('rm -rf /');
console.log(cmdResult.success);
// false

// Safe command — allowed
const safeResult = BrudAPI.validate.command('npm install');
console.log(safeResult.success);
// true
```

## Validating a Working Directory

```typescript
import { BrudAPI } from '@brud/core';

const workspaceFolders = ['/home/user/project'];

// Undefined cwd falls back to workspace root
const result1 = BrudAPI.validate.cwd(undefined, workspaceFolders);
console.log(result1.success);
// true
const data1 = result1.data as { resolvedCwd: string };
console.log(data1.resolvedCwd);
// '/home/user/project'

// Outside workspace — blocked
const result2 = BrudAPI.validate.cwd('/etc', workspaceFolders);
console.log(result2.success);
// false
```

## Validating Search/Replace Preconditions

```typescript
import { BrudAPI } from '@brud/core';
import type { FileSystem } from '@brud/core';

async function validateSearchReplace(fs: FileSystem, filePath: string, searchText: string) {
  // 1. File must exist
  const existsResult = await BrudAPI.validate.fileExists(fs, filePath);
  if (!existsResult.success) return existsResult;

  // 2. Search text must appear exactly once
  const matchResult = await BrudAPI.validate.singleMatch(fs, filePath, searchText);
  if (!matchResult.success) return matchResult;

  return matchResult;
}
```

## Combining Validations in Sequence

```typescript
import { BrudAPI } from '@brud/core';
import type { FileSystem } from '@brud/core';

interface ValidationContext {
  fs: FileSystem;
  workspaceFolders: string[];
}

async function validateCreateFile(
  ctx: ValidationContext,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  // 1. Workspace must be open
  const wsResult = BrudAPI.validate.workspace(ctx.workspaceFolders);
  if (!wsResult.success) {
    return { success: false, error: wsResult.friendly };
  }

  // 2. Path must be within workspace
  const pathResult = BrudAPI.validate.path(filePath, ctx.workspaceFolders);
  if (!pathResult.success) {
    return { success: false, error: pathResult.friendly };
  }

  // 3. File must not already exist
  const notExistsResult = await BrudAPI.validate.fileNotExists(ctx.fs, filePath);
  if (!notExistsResult.success) {
    return { success: false, error: notExistsResult.friendly };
  }

  return { success: true };
}
```

## Using the Error Object

```typescript
import { BrudAPI } from '@brud/core';
import { dangerousCommandError } from '@brud/core';

// The fail() function stores the error path in data
const result = BrudAPI.validate.command('sudo rm -rf /');
if (!result.success) {
  console.log(result.code);       // 'DANGEROUS_COMMAND'
  console.log(result.friendly);   // User-facing message
  console.log(result.details);    // Technical details

  // Construct an error instance
  const error = dangerousCommandError('sudo rm -rf /');
  console.log(error.code);        // 'DANGEROUS_COMMAND'
  console.log(error.command);     // 'sudo rm -rf /'
}
```
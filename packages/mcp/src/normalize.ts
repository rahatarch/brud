import * as path from 'path';

export type NormalizeFailureCode =
  | 'UNKNOWN_TOOL'
  | 'UNKNOWN_PARAMETER'
  | 'MISSING_PARAMETER'
  | 'INVALID_TYPE';

export interface NormalizeFailure {
  readonly ok: false;
  readonly code: NormalizeFailureCode;
  readonly message: string;
}

export type NormalizeResult =
  | { readonly ok: true; readonly input: Record<string, unknown> }
  | NormalizeFailure;

type ParamType = 'string' | 'number' | 'boolean' | 'string[]';
type ParamTransform = 'path' | 'list' | 'regexList' | 'commandGroup' | 'none';

interface ParamSpec {
  readonly field: string;
  readonly type: ParamType;
  readonly required?: boolean;
  readonly default?: unknown;
  readonly transform?: ParamTransform;
}

const DEFAULT_INDEX = '0';

function spec(field: string, type: ParamType, extra?: Omit<ParamSpec, 'field' | 'type'>): ParamSpec {
  return { field, type, ...extra };
}

const TOOL_SPECS: Record<string, Record<string, ParamSpec>> = {
  search_replace: {
    path: spec('path', 'string', { required: true, transform: 'path' }),
    search: spec('search', 'string', { required: true }),
    replace: spec('replace', 'string', { required: true }),
  },
  create_file: {
    path: spec('path', 'string', { required: true, transform: 'path' }),
    content: spec('content', 'string', { required: true }),
  },
  delete_file: {
    path: spec('path', 'string', { required: true, transform: 'path' }),
  },
  rename_file: {
    from: spec('from', 'string', { required: true, transform: 'path' }),
    to: spec('to', 'string', { required: true, transform: 'path' }),
  },
  move_file: {
    from: spec('from', 'string', { required: true, transform: 'path' }),
    to: spec('to', 'string', { required: true, transform: 'path' }),
  },
  copy_file: {
    from: spec('from', 'string', { required: true, transform: 'path' }),
    to: spec('to', 'string', { required: true, transform: 'path' }),
  },
  append_file: {
    path: spec('path', 'string', { required: true, transform: 'path' }),
    position: spec('position', 'string', { default: 'end' }),
    content: spec('content', 'string', { required: true }),
  },
  append_file_multi: {
    pattern: spec('patterns', 'string', { required: true, transform: 'list' }),
    scope: spec('directory', 'string', { transform: 'path' }),
    position: spec('position', 'string', { default: 'end' }),
    content: spec('content', 'string', { required: true }),
  },
  search_replace_multi: {
    pattern: spec('patterns', 'string', { required: true, transform: 'list' }),
    scope: spec('directory', 'string', { transform: 'path' }),
    search: spec('search', 'string', { required: true }),
    replace: spec('replace', 'string', { required: true }),
  },
  create_directory: {
    directoryPath: spec('directoryPath', 'string', { required: true, transform: 'path' }),
    files: spec('files', 'string[]', { default: [] }),
  },
  delete_directory: {
    directoryPath: spec('directoryPath', 'string', { required: true, transform: 'path' }),
  },
  move_directory: {
    from: spec('from', 'string', { required: true, transform: 'path' }),
    to: spec('to', 'string', { required: true, transform: 'path' }),
  },
  extract_structure: {
    directoryPath: spec('directoryPath', 'string', { required: true, transform: 'path' }),
    depth: spec('depth', 'number', { default: 0 }),
  },
  codebase_metadata: {},
  search_files: {
    pattern: spec('patterns', 'string', { required: true, transform: 'list' }),
    exclude: spec('excludePatterns', 'string', { transform: 'list' }),
    scope: spec('directory', 'string', { transform: 'path' }),
    maxResults: spec('maxResults', 'number', {}),
  },
  read_file: {
    filePath: spec('path', 'string', { required: true, transform: 'path' }),
    isImportRead: spec('isImportRead', 'boolean', { default: false }),
    maxDepth: spec('maxDepth', 'number', { default: 0 }),
    importSyntax: spec('importSyntax', 'string', { transform: 'regexList' }),
    exclude: spec('excludePatterns', 'string', { transform: 'list' }),
    startLine: spec('start_line', 'number', {}),
    endLine: spec('end_line', 'number', {}),
  },
  read_files: {
    pattern: spec('patterns', 'string', { required: true, transform: 'list' }),
    scope: spec('directory', 'string', { transform: 'path' }),
    maxResults: spec('maxResults', 'number', {}),
    isImportRead: spec('isImportRead', 'boolean', { default: false }),
  },
  read_directory: {
    directoryPath: spec('directoryPath', 'string', { required: true, transform: 'path' }),
    recursive: spec('recursive', 'boolean', { default: false }),
    exclude: spec('excludePatterns', 'string', { transform: 'list' }),
  },
  terminal_interactive: {
    command: spec('command', 'string', { required: true }),
    answers: spec('answers', 'string[]', { required: true }),
    timeout: spec('timeout', 'number', { default: 120 }),
  },
  terminal_command: {
    command: spec('command', 'string', {}),
    commands: spec('commands', 'string[]', {}),
    mode: spec('mode', 'string', {}),
    stopOnFailure: spec('stopOnFailure', 'boolean', { default: true }),
    onSuccess: spec('onSuccess', 'string', { transform: 'commandGroup' }),
    onFailure: spec('onFailure', 'string', { transform: 'commandGroup' }),
    timeout: spec('timeout', 'number', { default: 120 }),
  },
};

const RESERVED_PARAMETERS = new Set(['kind', 'index']);

const TOOL_CONSTANTS: Record<string, Record<string, unknown>> = {
  append_file_multi: { recursive: false },
  search_replace_multi: { recursive: false },
  search_files: { recursive: false },
  read_files: { recursive: false, maxDepth: 0 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, type: ParamType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    default:
      return false;
  }
}

function splitTopLevelList(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
    } else if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function applyTransform(value: unknown, transform: ParamTransform | undefined, workspaceRoot: string): unknown {
  switch (transform) {
    case 'path':
      return path.resolve(workspaceRoot, value as string);
    case 'list':
      return splitTopLevelList(value as string);
    case 'regexList':
      return [value as string];
    case 'commandGroup':
      return { type: 'sequential', commands: [value as string] };
    case 'none':
    default:
      return value;
  }
}

export function getToolParameterNames(kind: string): readonly string[] | undefined {
  const spec_ = TOOL_SPECS[kind];
  return spec_ ? Object.keys(spec_) : undefined;
}

export function normalizeArguments(
  kind: string,
  args: unknown,
  workspaceRoot: string,
): NormalizeResult {
  const specs = TOOL_SPECS[kind];
  if (!specs) {
    return { ok: false, code: 'UNKNOWN_TOOL', message: `Unknown tool kind: "${kind}".` };
  }

  const supplied: Record<string, unknown> = isRecord(args) ? args : {};

  for (const key of Object.keys(supplied)) {
    if (RESERVED_PARAMETERS.has(key)) {
      return {
        ok: false,
        code: 'UNKNOWN_PARAMETER',
        message: `Parameter "${key}" is reserved and cannot be supplied by a client.`,
      };
    }
    if (!(key in specs)) {
      return {
        ok: false,
        code: 'UNKNOWN_PARAMETER',
        message: `Unknown parameter "${key}" for tool "${kind}".`,
      };
    }
  }

  const input: Record<string, unknown> = {};

  for (const [name, param] of Object.entries(specs)) {
    const provided = supplied[name];
    let value: unknown;

    if (provided === undefined) {
      if (param.required) {
        return {
          ok: false,
          code: 'MISSING_PARAMETER',
          message: `Missing required parameter "${name}" for tool "${kind}".`,
        };
      }
      if (param.default === undefined) {
        continue;
      }
      value = param.default;
    } else {
      if (!matchesType(provided, param.type)) {
        return {
          ok: false,
          code: 'INVALID_TYPE',
          message: `Parameter "${name}" for tool "${kind}" must be of type ${param.type}.`,
        };
      }
      value = provided;
    }

    input[param.field] = applyTransform(value, param.transform, workspaceRoot);
  }

  input.kind = kind;
  input.index = DEFAULT_INDEX;
  Object.assign(input, TOOL_CONSTANTS[kind] ?? {});

  return { ok: true, input };
}

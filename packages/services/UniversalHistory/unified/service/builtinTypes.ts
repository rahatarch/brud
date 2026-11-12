/**
 * Kernel-owned entry types (namespace `brud.core`), registered at boot.
 * Schemas are validated by the U-1 JSON Schema subset validator.
 */

export const CORE_NAMESPACE = 'brud.core';

const SHA256 = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const NULLABLE_SHA256 = { oneOf: [{ type: 'null' }, SHA256] };

/** One recorded file mutation (undo/redo/checkpoint history). */
export const FILE_ENTRY_TYPE = {
  type: 'file',
  schemaVersion: 1,
  reversalMode: 'none' as const,
  payloadSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 4096 },
      operation: { enum: ['write', 'unlink', 'mkdir'] },
      preSha256: NULLABLE_SHA256,
      postSha256: NULLABLE_SHA256,
      preCaptured: { type: 'boolean' },
      nodeKind: { enum: ['missing', 'file', 'directory'] },
      size: { type: 'integer', minimum: 0 },
    },
    required: ['path', 'operation', 'preSha256', 'postSha256', 'preCaptured', 'nodeKind', 'size'],
    additionalProperties: false,
  },
};

/** Pre/post state of one changed declared target of a committed session. */
export const SESSION_TARGET_ENTRY_TYPE = {
  type: 'session-target',
  schemaVersion: 1,
  reversalMode: 'none' as const,
  payloadSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1, maxLength: 4096 },
      preSha256: NULLABLE_SHA256,
      postSha256: NULLABLE_SHA256,
      preSize: { type: 'integer', minimum: 0 },
      postSize: { type: 'integer', minimum: 0 },
      isBinary: { type: 'boolean' },
    },
    required: ['path', 'preSha256', 'postSha256', 'preSize', 'postSize', 'isBinary'],
    additionalProperties: false,
  },
};

export const BUILTIN_ENTRY_TYPES = [FILE_ENTRY_TYPE, SESSION_TARGET_ENTRY_TYPE] as const;

export interface FileEntryPayload {
  readonly path: string;
  readonly operation: 'write' | 'unlink' | 'mkdir';
  readonly preSha256: string | null;
  readonly postSha256: string | null;
  readonly preCaptured: boolean;
  readonly nodeKind: 'missing' | 'file' | 'directory';
  readonly size: number;
}

export interface SessionTargetPayload {
  readonly path: string;
  readonly preSha256: string | null;
  readonly postSha256: string | null;
  readonly preSize: number;
  readonly postSize: number;
  readonly isBinary: boolean;
}

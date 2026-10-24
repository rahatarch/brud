import type { ReactNode } from 'react';
import type {
  CodebaseMetadataResult,
  ReadFileEntry,
  ReportSection,
  SearchFilesResult,
  StructureResult,
} from '@brud/protocol';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ReadResultPayload {
  files: ReadFileEntry[];
  totalFiles?: number;
  totalSize?: number;
}

export interface TerminalResultPayload {
  command: string;
  output: string;
  exitCode: number | null;
  duration: number;
  success: boolean;
  code?: string;
  details?: string;
  status?: string;
}

export type TerminalGroupMode = 'single' | 'sequential' | 'parallel' | 'conditional';

export interface TerminalGroupPayload {
  mode: TerminalGroupMode;
  results: TerminalResultPayload[];
  totalDuration: number;
  succeeded: number;
  failed: number;
}

export type TerminalPayload = TerminalResultPayload | TerminalResultPayload[] | TerminalGroupPayload;

export interface TerminalStreamingState {
  isRunning: boolean;
  processId?: string;
}

export interface ToolInfoPayload {
  message: string;
  status?: string;
  toolKind?: string;
  kind?: string;
  code?: string;
  details?: string;
}

export interface ErrorPayload {
  friendlyMessage: string;
  message?: string;
  stack?: string;
  details?: string;
  structured?: ReportSection[];
}

export type OperationStatus = 'success' | 'failed' | 'aborted' | 'interrupted';

export interface OperationFileResults {
  modified: string[];
  skipped: string[];
  failed: string[];
}

export interface OperationResultPayload {
  kind: string;
  status: OperationStatus;
  operationId?: string;
  operationIndex?: number;
  message?: string;
  code?: string;
  details?: string;
  path?: string;
  from?: string;
  to?: string;
  title?: string;
  description?: string;
  directoryPath?: string;
  files?: string[];
  fileResults?: OperationFileResults;
  data?: unknown;
}

export interface ResultPayloadMap {
  readResults: ReadResultPayload;
  search_files: SearchFilesResult;
  extractionResults: StructureResult;
  codebase_metadata: CodebaseMetadataResult;
  terminal_command: TerminalPayload;
  tool_info: ToolInfoPayload;
  error: ErrorPayload;
  operation_result: OperationResultPayload;
}

export type ResultKind = keyof ResultPayloadMap;

export type ResultPayload = ResultPayloadMap[ResultKind];

export interface ToolResultRenderer {
  toolKind: string;
  title: string;
  canRender: (data: unknown) => boolean;
  renderSection: (data: unknown) => ReactNode;
  copyFormatter: (data: unknown) => string;
  summaryFormatter?: (data: unknown) => string;
}

const OPERATION_STATUSES: readonly OperationStatus[] = ['success', 'failed', 'aborted', 'interrupted'];

const TERMINAL_GROUP_MODES: readonly TerminalGroupMode[] = ['single', 'sequential', 'parallel', 'conditional'];

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isReadFileEntry(value: unknown): value is ReadFileEntry {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.content === 'string'
    && typeof value.size === 'number';
}

export function isReadResultPayload(data: unknown): data is ReadResultPayload {
  return isRecord(data)
    && Array.isArray(data.files)
    && data.files.every(isReadFileEntry)
    && isOptionalNumber(data.totalFiles)
    && isOptionalNumber(data.totalSize);
}

function isSearchFileItem(value: unknown): boolean {
  return isRecord(value)
    && typeof value.path === 'string'
    && typeof value.name === 'string'
    && typeof value.extension === 'string'
    && typeof value.directory === 'string'
    && typeof value.size === 'number';
}

export function isSearchResultPayload(data: unknown): data is SearchFilesResult {
  return isRecord(data)
    && Array.isArray(data.results)
    && data.results.every(isSearchFileItem)
    && typeof data.totalMatches === 'number'
    && typeof data.truncated === 'boolean';
}

export function isStructurePayload(data: unknown): data is StructureResult {
  return isRecord(data)
    && typeof data.json === 'string'
    && typeof data.directoryPath === 'string'
    && typeof data.depth === 'number'
    && typeof data.fileCount === 'number'
    && typeof data.directoryCount === 'number';
}

export function isCodebaseMetadataPayload(data: unknown): data is CodebaseMetadataResult {
  return isRecord(data)
    && typeof data.root === 'string'
    && typeof data.totalFiles === 'number'
    && typeof data.totalFolders === 'number'
    && typeof data.mostDenseFolder === 'string'
    && typeof data.mostDenseCount === 'number';
}

export function isTerminalResultPayload(data: unknown): data is TerminalResultPayload {
  return isRecord(data)
    && typeof data.command === 'string'
    && typeof data.output === 'string'
    && (data.exitCode === null || typeof data.exitCode === 'number')
    && typeof data.duration === 'number'
    && typeof data.success === 'boolean'
    && isOptionalString(data.code)
    && isOptionalString(data.details)
    && isOptionalString(data.status);
}

export function isTerminalGroupPayload(data: unknown): data is TerminalGroupPayload {
  return isRecord(data)
    && typeof data.mode === 'string'
    && (TERMINAL_GROUP_MODES as readonly string[]).includes(data.mode)
    && Array.isArray(data.results)
    && data.results.every(isTerminalResultPayload)
    && typeof data.totalDuration === 'number'
    && typeof data.succeeded === 'number'
    && typeof data.failed === 'number';
}

export function isTerminalPayload(data: unknown): data is TerminalPayload {
  if (isTerminalGroupPayload(data)) {
    return true;
  }
  if (Array.isArray(data)) {
    return data.every(isTerminalResultPayload);
  }
  return isTerminalResultPayload(data);
}

export function getTerminalStreamingState(data: unknown): TerminalStreamingState {
  if (!isRecord(data)) {
    return { isRunning: false };
  }
  return {
    isRunning: data.isRunning === true,
    processId: typeof data.processId === 'string' ? data.processId : undefined,
  };
}

export function isToolInfoPayload(data: unknown): data is ToolInfoPayload {
  return isRecord(data)
    && typeof data.message === 'string'
    && isOptionalString(data.status)
    && isOptionalString(data.toolKind)
    && isOptionalString(data.kind)
    && isOptionalString(data.code)
    && isOptionalString(data.details);
}

export function isErrorPayload(data: unknown): data is ErrorPayload {
  return isRecord(data)
    && typeof data.friendlyMessage === 'string'
    && isOptionalString(data.message)
    && isOptionalString(data.stack)
    && isOptionalString(data.details)
    && (data.structured === undefined || Array.isArray(data.structured));
}

function isOperationFileResults(value: unknown): value is OperationFileResults {
  return isRecord(value)
    && isStringArray(value.modified)
    && isStringArray(value.skipped)
    && isStringArray(value.failed);
}

export function isOperationResultPayload(data: unknown): data is OperationResultPayload {
  return isRecord(data)
    && typeof data.kind === 'string'
    && typeof data.status === 'string'
    && (OPERATION_STATUSES as readonly string[]).includes(data.status)
    && isOptionalString(data.operationId)
    && isOptionalNumber(data.operationIndex)
    && isOptionalString(data.message)
    && isOptionalString(data.code)
    && isOptionalString(data.details)
    && isOptionalString(data.path)
    && isOptionalString(data.from)
    && isOptionalString(data.to)
    && isOptionalString(data.title)
    && isOptionalString(data.description)
    && isOptionalString(data.directoryPath)
    && (data.files === undefined || isStringArray(data.files))
    && (data.fileResults === undefined || isOperationFileResults(data.fileResults));
}

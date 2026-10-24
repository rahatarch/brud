import { isRecord } from '@brud/protocol';
import type {
  CodebaseMetadataResult,
  OperationResult,
  ReadFileEntry,
  ReadResultData,
  SearchFilesResult,
  StructureResult,
} from '@brud/protocol';

const OPERATION_STATUSES: readonly OperationResult['status'][] = ['success', 'failed', 'aborted', 'interrupted'];

export interface SearchResultsEnvelope {
  operationIndex: number;
  results: SearchFilesResult;
}

export interface StructuredExecutionMessage {
  extractionResults?: StructureResult[];
  readResults?: ReadResultData[];
  searchResults?: SearchResultsEnvelope[];
  codebaseMetadata?: CodebaseMetadataResult;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isReadFileEntry(value: unknown): value is ReadFileEntry {
  return isRecord(value)
    && isString(value.path)
    && isString(value.content)
    && typeof value.size === 'number';
}

export function isReadResultData(value: unknown): value is ReadResultData {
  return isRecord(value)
    && Array.isArray(value.files)
    && value.files.every(isReadFileEntry)
    && typeof value.totalFiles === 'number'
    && typeof value.totalSize === 'number';
}

export function isStructureResult(value: unknown): value is StructureResult {
  return isRecord(value)
    && isString(value.json)
    && isString(value.directoryPath)
    && typeof value.depth === 'number'
    && typeof value.fileCount === 'number'
    && typeof value.directoryCount === 'number';
}

function isSearchFileItem(value: unknown): boolean {
  return isRecord(value)
    && isString(value.path)
    && isString(value.name)
    && isString(value.extension)
    && isString(value.directory)
    && typeof value.size === 'number';
}

export function isSearchFilesResult(value: unknown): value is SearchFilesResult {
  return isRecord(value)
    && Array.isArray(value.results)
    && value.results.every(isSearchFileItem)
    && typeof value.totalMatches === 'number'
    && typeof value.truncated === 'boolean';
}

export function isCodebaseMetadataResult(value: unknown): value is CodebaseMetadataResult {
  return isRecord(value)
    && isString(value.root)
    && typeof value.totalFiles === 'number'
    && typeof value.totalFolders === 'number'
    && isString(value.mostDenseFolder)
    && typeof value.mostDenseCount === 'number';
}

function isOperationResult(value: unknown): value is OperationResult {
  return isRecord(value)
    && isString(value.operationId)
    && typeof value.operationIndex === 'number'
    && isString(value.kind)
    && isString(value.status)
    && (OPERATION_STATUSES as readonly string[]).includes(value.status)
    && isString(value.message)
    && isString(value.path);
}

export function readOperationResults(value: unknown): OperationResult[] {
  return Array.isArray(value) ? value.filter(isOperationResult) : [];
}

function isSearchResultsEnvelope(value: unknown): value is SearchResultsEnvelope {
  return isRecord(value)
    && typeof value.operationIndex === 'number'
    && isSearchFilesResult(value.results);
}

export function parseStructuredExecutionMessage(raw: string): StructuredExecutionMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  return {
    extractionResults: Array.isArray(parsed.extractionResults)
      ? parsed.extractionResults.filter(isStructureResult)
      : undefined,
    readResults: Array.isArray(parsed.readResults)
      ? parsed.readResults.filter(isReadResultData)
      : undefined,
    searchResults: Array.isArray(parsed.search_results)
      ? parsed.search_results.filter(isSearchResultsEnvelope)
      : undefined,
    codebaseMetadata: isCodebaseMetadataResult(parsed.codebase_metadata)
      ? parsed.codebase_metadata
      : undefined,
  };
}

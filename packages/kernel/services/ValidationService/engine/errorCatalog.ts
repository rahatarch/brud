import type { ValidationCode } from '../contracts/errors.js';
import type { RuleTraits } from '../contracts/IValidationService.js';
import type { ValidationRule } from '../contracts/rules.js';

/**
 * Rule traits and message templates.
 *
 * `friendly` strings are reproduced verbatim from
 * `packages/core/src/api/errors.ts` so the legacy facade keeps producing the
 * exact text its callers, tests and UI already show. Actionability and
 * retryability are the audited §2 last column: a value that appears nowhere in
 * the legacy code base but is required by the `ValidationDecision` contract.
 */

const TRAITS: Readonly<Record<ValidationRule, RuleTraits>> = Object.freeze({
  'PATH.NULL_BYTE': { actionable: true, retryable: false },
  'PATH.UNC_OR_DEVICE': { actionable: true, retryable: false },
  'PATH.DRIVE_QUALIFIED': { actionable: true, retryable: false },
  'PATH.DRIVE_RELATIVE': { actionable: true, retryable: false },
  'PATH.ABSOLUTE': { actionable: true, retryable: false },
  'PATH.PARENT_SEGMENT': { actionable: true, retryable: false },
  'PATH.WIN_TRAILING_DOT_OR_SPACE': { actionable: true, retryable: false },
  'PATH.WIN_TRAILING_ALIAS_TRAVERSAL': { actionable: true, retryable: false },
  'PATH.WIN_RESERVED_DEVICE': { actionable: true, retryable: false },
  'PATH.WIN_ALT_DATA_STREAM': { actionable: true, retryable: false },
  'PATH.OUTSIDE_ROOT': { actionable: true, retryable: false },
  'PATH.SIBLING_PREFIX': { actionable: true, retryable: false },
  'PATH.SYMLINK_ESCAPE': { actionable: true, retryable: false },
  'PATH.UNVERIFIABLE_LINEAGE': { actionable: false, retryable: true },
  'PATH.AMBIGUOUS_ROOT': { actionable: false, retryable: false },
  'PATH.UNKNOWN_ROOT': { actionable: false, retryable: false },
  'PATH.INVALID_ROOT': { actionable: false, retryable: false },
  'PATH.NO_WORKSPACE': { actionable: true, retryable: true },
  'PATH.PROTECTED_DENY': { actionable: true, retryable: false },
  'PATH.ROOT_NOT_MUTABLE': { actionable: true, retryable: false },
  'PATH.CWD_ESCAPE': { actionable: true, retryable: false },
  'PATH.CWD_DYNAMIC': { actionable: true, retryable: false },
  'PATH.CWD_INVALID': { actionable: true, retryable: false },
  'PATH.LISTING_OUTSIDE': { actionable: true, retryable: false },
  'PATH.NON_STRING': { actionable: true, retryable: false },

  'CMD.RM_ROOT': { actionable: true, retryable: false },
  'CMD.RM_GLOB': { actionable: true, retryable: false },
  'CMD.PRIVILEGE': { actionable: true, retryable: false },
  'CMD.DISK': { actionable: true, retryable: false },
  'CMD.PIPE_SHELL': { actionable: true, retryable: false },
  'CMD.PERMISSION_WIDEN': { actionable: true, retryable: false },
  'CMD.DEVICE_REDIRECT': { actionable: true, retryable: false },
  'CMD.FORK_BOMB': { actionable: true, retryable: false },
  'CMD.FORCED_PKG': { actionable: true, retryable: false },
  'CMD.TERMINAL_UNAVAILABLE': { actionable: false, retryable: true },
  'CMD.NO_COMMAND': { actionable: true, retryable: false },

  'INPUT.UNKNOWN_OPERATION': { actionable: true, retryable: false },
  'INPUT.UNKNOWN_TOOL': { actionable: true, retryable: false },
  'INPUT.TOOL_DISABLED': { actionable: true, retryable: false },
  'INPUT.MISSING_FIELD': { actionable: true, retryable: false },
  'INPUT.MISSING_INDEX': { actionable: true, retryable: false },
  'INPUT.INVALID_POSITION': { actionable: true, retryable: false },
  'INPUT.INVALID_MODE': { actionable: true, retryable: false },
  'INPUT.EMPTY_PATTERNS': { actionable: true, retryable: false },
  'INPUT.EMPTY_ANSWERS': { actionable: true, retryable: false },
  'INPUT.EMPTY_OPERATIONS': { actionable: true, retryable: false },
  'INPUT.NO_EXTRACT_OPS': { actionable: true, retryable: false },
  'INPUT.PARSE_FORMAT': { actionable: true, retryable: false },
  'INPUT.LINE_RANGE': { actionable: true, retryable: false },
  'INPUT.BATCH_LIMIT': { actionable: true, retryable: true },
  'INPUT.PREVIEW_UNSUPPORTED': { actionable: true, retryable: false },
  'INPUT.NO_PREVIEW': { actionable: true, retryable: false },
  'INPUT.SEARCH_NOT_FOUND': { actionable: true, retryable: false },
  'INPUT.MULTIPLE_MATCHES': { actionable: true, retryable: false },
  'INPUT.TARGET_KIND': { actionable: true, retryable: false },
  'INPUT.READ_ONLY_PROJECTION': { actionable: false, retryable: false },
  'INPUT.SESSION_MISSING': { actionable: true, retryable: true },
  'INPUT.REVERT_REQUEST': { actionable: true, retryable: false },
  'INPUT.METADATA_WRONG_CASE': { actionable: true, retryable: false },
  'INPUT.DUPLICATE_SESSION_METADATA': { actionable: true, retryable: false },
  'INPUT.DUPLICATE_OPERATION_METADATA': { actionable: true, retryable: false },
  'INPUT.METADATA_FIELD_CASE': { actionable: true, retryable: false },
  'INPUT.METADATA_UNKNOWN_FIELD': { actionable: true, retryable: false },
  'INPUT.SESSION_METADATA_POSITION': { actionable: true, retryable: false },
  'INPUT.OPERATION_METADATA_POSITION': { actionable: true, retryable: false },
  'INPUT.METADATA_UNCLOSED': { actionable: true, retryable: false },

  'POLICY.BOUNDARY_DISABLED': { actionable: false, retryable: false },
  'POLICY.COMMAND_VALIDATION_DISABLED': { actionable: false, retryable: false },
  'POLICY.PER_CALL_OVERRIDE': { actionable: true, retryable: false },
  'POLICY.SAFETY_LOOSENING': { actionable: false, retryable: false },
  'POLICY.MID_SESSION_LOOSENING': { actionable: false, retryable: false },
  'POLICY.VALUE_CLAMPED': { actionable: false, retryable: false },
  'POLICY.READ_CONCURRENCY': { actionable: false, retryable: false },
  'POLICY.AGGREGATE_BYTES': { actionable: true, retryable: true },
} satisfies Record<ValidationRule, RuleTraits>);

/**
 * Looks up a rule's traits.
 *
 * @param rule - Rule id.
 */
export function ruleTraits(rule: ValidationRule): RuleTraits {
  return TRAITS[rule];
}

/** Message pair a decision exposes. */
export interface MessagePair {
  readonly friendly: string;
  readonly details: string;
}

/** Values a message template may interpolate. */
export interface MessageValues {
  readonly path?: string;
  readonly command?: string;
  readonly target?: string;
  readonly operation?: string;
  readonly reason?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly totalLines?: number;
  readonly requested?: number;
  readonly limit?: number;
  readonly rule?: string;
  readonly wrapper?: string;
  readonly index?: string;
  readonly field?: string;
}

/**
 * Verbatim legacy message pair for a code.
 *
 * Every string here is copied from `api/errors.ts`; `details` uses the same
 * template variables, so a legacy caller observes byte-identical output.
 *
 * @param code - Kernel code.
 * @param values - Template values.
 */
export function legacyMessages(code: ValidationCode, values: MessageValues = {}): MessagePair {
  const path = values.path ?? '';
  const operation = values.operation;

  switch (code) {
    case 'NO_WORKSPACE':
      return {
        friendly: 'No workspace is currently open.',
        details: 'Open a folder in VS Code to use file operations.',
      };
    case 'PATH_TRAVERSAL_DETECTED':
      return {
        friendly: 'The path is outside the current workspace.',
        details: `The path "${path}" is outside the current workspace. File operations are restricted to files and folders inside the workspace.`,
      };
    case 'WORKSPACE_PATH_VIOLATION':
      return {
        friendly: values.reason ?? 'The path failed workspace validation.',
        details: values.reason ?? `The path "${path}" failed workspace validation.`,
      };
    case 'WORKSPACE_CONFIGURATION_INVALID':
      return {
        friendly: 'The workspace configuration is invalid.',
        details: values.reason ?? 'The workspace root registry is not usable.',
      };
    case 'DANGEROUS_COMMAND':
      return {
        friendly: 'The command is potentially dangerous and has been blocked.',
        details: `The command "${values.command ?? ''}" matches a known dangerous pattern and has been blocked for security reasons.`,
      };
    case 'INVALID_CWD':
      return {
        friendly: 'The working directory is invalid.',
        details: `The working directory "${path}" is outside the workspace or does not exist.`,
      };
    case 'CWD_ESCAPE':
      return {
        friendly: 'Command attempts to leave the workspace.',
        details: `The command attempts to cd to "${values.target ?? ''}", which is outside the current workspace. Commands can only run inside the workspace.`,
      };
    case 'DYNAMIC_PATH':
      return {
        friendly: 'Command uses a dynamic path that cannot be verified.',
        details: `The command attempts to cd to "${values.target ?? ''}", which contains a variable or expression that cannot be statically resolved. Commands can only use static paths.`,
      };
    case 'TERMINAL_UNAVAILABLE':
      return {
        friendly: 'Terminal executor is not available.',
        details: 'The terminal executor could not be initialized. Check the platform adapter configuration.',
      };
    case 'FILE_NOT_FOUND':
      return { friendly: 'The specified file was not found.', details: `No file found at "${path}".` };
    case 'FILE_ALREADY_EXISTS':
      return { friendly: 'The file already exists.', details: `A file already exists at "${path}".` };
    case 'DIRECTORY_NOT_FOUND':
      return { friendly: 'The specified directory was not found.', details: `No directory found at "${path}".` };
    case 'DIRECTORY_ALREADY_EXISTS':
      return { friendly: 'The directory already exists.', details: `A directory already exists at "${path}".` };
    case 'SEARCH_NOT_FOUND':
      return {
        friendly: 'The search text was not found.',
        details: values.reason ?? `The search text was not found in "${path}".`,
      };
    case 'MULTIPLE_MATCHES':
      return {
        friendly: 'Multiple matches found.',
        details: values.reason ?? `Multiple matches found in "${path}". Expected a single match.`,
      };
    case 'PREVIEW_NOT_AVAILABLE':
      return {
        friendly: 'Preview not available for this operation type.',
        details: 'Preview not available for this operation type.',
      };
    case 'NO_VALID_OPERATIONS':
      return { friendly: 'No valid operations found.', details: 'No valid operations found.' };
    case 'NO_PREVIEW':
      return {
        friendly: 'No preview could be generated for any file.',
        details: 'No preview could be generated for any file.',
      };
    case 'NO_EXTRACT_OPERATIONS':
      return {
        friendly: 'No extract_structure operations found.',
        details: 'No extract_structure operations found.',
      };
    case 'MISSING_FIELD':
      return {
        friendly: `Missing required field: ${values.field ?? ''}`,
        details: `The field "${values.field ?? ''}" is required${operation === undefined ? '' : ` in ${operation} operation`}.`,
      };
    case 'INVALID_FIELD':
      return {
        friendly: `Invalid value for field: ${values.field ?? ''}`,
        details: values.reason ?? `The value for "${values.field ?? ''}" is invalid.`,
      };
    case 'MISSING_INDEX':
      return {
        friendly: 'You haven\'t used any index number with your instructions.',
        details: 'Please use index with instructions in this format: TOOL_CALL [INDEX]. Example: READ_FILE [1]',
      };
    case 'PARSE_ERROR':
      return {
        friendly: 'I couldn\'t understand the format of your message.',
        details: 'Brud Code understands two formats: the legacy block format and YAML. If you are an AI, call GET_TOOL_INFO first to fetch the tool syntax.',
      };
    case 'UNKNOWN_OPERATION':
      return {
        friendly: `Unrecognized operation: ${operation ?? values.reason ?? ''}`,
        details: `The operation "${operation ?? values.reason ?? ''}" is not supported by Brud Code. Use GET_TOOL_INFO to see available tools.`,
      };
    case 'DELETE_FAILED':
      return {
        friendly: `Failed to delete: ${path}`,
        details: `The file or directory at "${path}" could not be deleted. Check permissions and try again.`,
      };
    case 'TOOL_NOT_FOUND':
      return {
        friendly: `Tool not found: ${operation ?? values.reason ?? ''}`,
        details: `The tool "${operation ?? values.reason ?? ''}" does not exist. Use GET_TOOL_INFO to see available tools.`,
      };
    case 'TOOL_DISABLED':
      return {
        friendly: `Tool "${operation ?? ''}" is disabled.`,
        details: `The tool "${operation ?? ''}" has been disabled in .brud/settings.json. Enable it to use this operation.`,
      };
    case 'SESSION_NOT_FOUND':
      return {
        friendly: `Session not found: ${values.reason ?? ''}`,
        details: `The session "${values.reason ?? ''}" does not exist in history. It may have been deleted or expired.`,
      };
    case 'INVALID_REVERT_REQUEST':
      return {
        friendly: 'Invalid revert request.',
        details: 'Cannot revert without sessionId and targetState.',
      };
    case 'READ_ONLY_VIOLATION':
      return {
        friendly: 'This operation is not permitted on a read-only view.',
        details: values.reason ?? 'A mutation was attempted through a read-only projection.',
      };
    case 'CANNOT_WRITE_DIRECTORY':
      return {
        friendly: 'Cannot write to a directory.',
        details: `Cannot write to a directory: "${path}".`,
      };
    case 'CANNOT_DELETE_DIRECTORY':
      return {
        friendly: 'Cannot delete a directory as a file.',
        details: `Cannot delete the directory "${path}" as a file.`,
      };
    case 'INVALID_LINE_RANGE':
      return {
        friendly: 'Invalid line range specified for file read.',
        details: `Requested line range ${values.startLine ?? '?'}-${values.endLine ?? '?'} is invalid for file with ${values.totalLines ?? '?'} lines (1-indexed).`,
      };
    case 'BATCH_LIMIT_EXCEEDED':
      return {
        friendly: 'Read batch too large.',
        details: `Requested ${values.requested ?? '?'} files; the limit is ${values.limit ?? '?'} per batch. Narrow the pattern, add excludePatterns, or split the read into sequential batches of ${values.limit ?? '?'} or fewer.`,
      };
    case 'UNEXPECTED_ERROR':
      return {
        friendly: 'An unexpected error occurred.',
        details: `Unexpected error during ${operation ?? 'operation'}: ${values.reason ?? ''}`,
      };
    case 'E_METADATA_WRONG_CASE': {
      const wrapper = values.wrapper ?? '';

      return {
        friendly: 'Metadata wrapper must be lowercase.',
        details: `Metadata wrapper '<${wrapper}>' must be lowercase. Found '<${wrapper}>'.`,
      };
    }
    case 'E_DUPLICATE_SESSION_METADATA':
      return {
        friendly: 'Duplicate session metadata block.',
        details: 'Duplicate session metadata block. Only one <session_metadata> block is allowed.',
      };
    case 'E_DUPLICATE_OPERATION_METADATA': {
      const index = values.index ?? '';

      return {
        friendly: `Duplicate operation metadata block in operation '${index}'.`,
        details: `Duplicate operation metadata block in operation '${index}'. Only one <operation_metadata> block is allowed per operation.`,
      };
    }
    case 'E_METADATA_FIELD_CASE': {
      const field = values.field ?? '';
      const lower = (field.endsWith(':') ? field.slice(0, -1) : field).toLowerCase();

      return {
        friendly: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
        details: `Metadata field '${field}' must be lowercase. Did you mean '${lower}:'?`,
      };
    }
    case 'E_METADATA_UNKNOWN_FIELD': {
      const field = values.field ?? '';

      return {
        friendly: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
        details: `Unknown metadata field '${field}'. Only 'title:' and 'description:' are allowed.`,
      };
    }
    case 'E_SESSION_METADATA_POSITION':
      return {
        friendly: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
        details: 'Session metadata must be the first element after <BRUD_INSTRUCTIONS>.',
      };
    case 'E_OPERATION_METADATA_POSITION':
      return {
        friendly: 'Operation metadata must appear before the content separator.',
        details: `Operation metadata must appear before the content separator in operation '${values.index ?? ''}'.`,
      };
    case 'E_METADATA_UNCLOSED': {
      const wrapper = values.wrapper ?? '';

      return {
        friendly: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
        details: `Unclosed <${wrapper}> wrapper. Expected </${wrapper}>.`,
      };
    }
    default: {
      const exhaustive: never = code;

      return { friendly: `Validation failed (${String(exhaustive)}).`, details: values.reason ?? '' };
    }
  }
}

/**
 * Builds the `VALIDATION_ERROR`-style pair a legacy caller expected when no
 * dedicated factory existed.
 *
 * @param string - Friendly text, also used as details.
 */
export function validationErrorMessages(string: string): MessagePair {
  return { friendly: string, details: string };
}

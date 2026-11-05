export {
  TerminalToolError,
  failureCodeFor,
  failureDetailsFor,
  internalFailure,
  isGroupResult,
  runWithCancellation,
  terminalFailureResult,
  toCommandData,
  toCommandGroup,
  toGroupData,
  toMilliseconds,
} from './terminalResult.js';
export type {
  TerminalCommandData,
  TerminalFailureCode,
  TerminalFailureData,
  TerminalOperationResult,
  TerminalToolErrorOptions,
} from './terminalResult.js';
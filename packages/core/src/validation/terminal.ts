import type { CommandRule } from '@brud/kernel' with { 'resolution-mode': 'import' };
import { BrudAPI } from '../api/index';
import type { ValidationResult } from '../api/types';
import { policyFromSettings, validateCommand } from '../api/validationFacade';
import type { BrudSettings } from '../settings/types';
import { DEFAULT_SETTINGS } from '../settings/types';

/**
 * `CMD.*` verdicts that mean "the command itself is dangerous".
 *
 * `CMD.NO_COMMAND` and `CMD.TERMINAL_UNAVAILABLE` are also `CMD.*` rules, but
 * they describe an unusable request rather than a destructive one, so they are
 * not dangerous-command verdicts.
 */
const DANGEROUS_COMMAND_RULES: ReadonlySet<CommandRule> = new Set<CommandRule>([
  'CMD.RM_ROOT',
  'CMD.RM_GLOB',
  'CMD.PRIVILEGE',
  'CMD.DISK',
  'CMD.PIPE_SHELL',
  'CMD.PERMISSION_WIDEN',
  'CMD.DEVICE_REDIRECT',
  'CMD.FORK_BOMB',
  'CMD.FORCED_PKG',
]);

/**
 * Reports whether a command fails specifically under a dangerous-command rule.
 *
 * `BrudAPI.validate.command` also rejects containment failures, so a bare
 * `!success` would classify harmless CWD/path violations (`PATH.CWD_ESCAPE`,
 * `PATH.CWD_DYNAMIC`, `PATH.*`) as dangerous. The kernel decision carries the
 * violated rule, so the predicate only consults failures whose rule belongs to
 * the `CMD.*` category and is one of the scanner's denylist verdicts.
 *
 * @param command - Command text.
 */
export function isDangerousCommand(command: string): boolean {
  const decision = BrudAPI.validate.commandDecision(command);

  if (decision.ok || !decision.rule.startsWith('CMD.')) {
    return false;
  }

  return DANGEROUS_COMMAND_RULES.has(decision.rule as CommandRule);
}

/**
 * Validates a terminal command at the legacy execution boundary.
 *
 * The two booleans are the *boot policy* of the execution batch
 * (`executeFileOperations` receives settings once and passes them here), not a
 * per-call override: `BrudAPI.validate.command` no longer accepts policy
 * options, so a caller cannot disable validation for a single call.
 *
 * @param command - Command text.
 * @param cwd - Explicit working directory.
 * @param workspaceFolders - Registered workspace folders.
 * @param workspaceBoundaryEnabled - Frozen boundary switch.
 * @param commandValidationEnabled - Frozen command-safety switch.
 */
export function validateTerminalCommand(
  command: string,
  cwd: string | undefined,
  workspaceFolders: string[],
  workspaceBoundaryEnabled?: boolean,
  commandValidationEnabled?: boolean,
): ValidationResult {
  const settings: BrudSettings = {
    ...DEFAULT_SETTINGS,
    workspaceBoundaryEnabled: workspaceBoundaryEnabled !== false,
    commandValidationEnabled: commandValidationEnabled !== false,
  };

  return validateCommand(command, cwd, workspaceFolders, policyFromSettings(settings));
}

export function validateTerminalCwd(
  cwd: string | undefined,
  workspaceFolders: string[],
): { valid: boolean; resolvedCwd?: string; error?: string } {
  const result = BrudAPI.validate.cwd(cwd, workspaceFolders);
  if (!result.success) {
    return { valid: false, error: result.friendly || result.details };
  }
  const data = result.data as { resolvedCwd?: string } | undefined;
  return { valid: true, resolvedCwd: data?.resolvedCwd };
}
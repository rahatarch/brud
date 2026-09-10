import { BrudAPI } from '../api/index';
import type { ValidationResult } from '../api/types';

export function isDangerousCommand(command: string): boolean {
  const result = BrudAPI.validate.command(command);
  return !result.success;
}

export function validateTerminalCommand(
  command: string,
  cwd: string | undefined,
  workspaceFolders: string[],
): ValidationResult {
  return BrudAPI.validate.command(command, cwd, workspaceFolders);
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
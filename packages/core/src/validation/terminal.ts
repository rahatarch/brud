import { validateWorkspacePath } from '../utils/workspacePath';

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-(?:rf|fr)\s+(\/|\/\*|~|\.)(?:$|\s)/,
  /\brm\s+-(?:rf|fr)\s+\*\s*$/,
  /\bsudo\b/,
  /\bsu\b/,
  /\bpkexec\b/,
  /\bmkfs\b/,
  /\bfdisk\b/,
  /\bdd\s+if=/,
  /curl\s+.*\|\s*(bash|sh)\b/,
  /wget\s+.*\|\s*(bash|sh)\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bchown\s+-R\b/,
  />\s+\/dev\/sd/,
  />\s+\/dev\/nvme/,
  /:\s*\(\)\s*\{[^}]*:\s*:\s*\(\)\s*\|/,
  /\bapt-get\s+--force-yes\b/,
  /\bnpm\s+--unsafe-perm\b/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

export function validateTerminalCwd(
  cwd: string | undefined,
  workspaceFolders: string[],
): { valid: boolean; resolvedCwd?: string; error?: string } {
  if (!cwd || cwd.trim() === '') {
    if (workspaceFolders.length === 0) {
      return { valid: false, error: 'No workspace folders available to resolve cwd.' };
    }
    return { valid: true, resolvedCwd: workspaceFolders[0] };
  }

  const result = validateWorkspacePath(cwd, workspaceFolders);
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true, resolvedCwd: result.resolvedPath };
}
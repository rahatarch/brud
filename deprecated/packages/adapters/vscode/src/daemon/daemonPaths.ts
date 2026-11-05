import { isAbsolute, relative, resolve, sep } from 'node:path';

export class DaemonPathOutsideWorkspaceError extends Error {
  readonly workspaceRoot: string;

  readonly candidatePath: string;

  constructor(workspaceRoot: string, candidatePath: string) {
    super(
      `The path "${candidatePath}" is outside the daemon workspace "${workspaceRoot}"`,
    );
    this.name = 'DaemonPathOutsideWorkspaceError';
    this.workspaceRoot = workspaceRoot;
    this.candidatePath = candidatePath;
  }
}

export function toWorkspaceRelativePath(
  workspaceRoot: string,
  candidatePath: string,
): string {
  const root = resolve(workspaceRoot);
  const absolutePath = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root, candidatePath);
  const relativePath = relative(root, absolutePath);

  if (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new DaemonPathOutsideWorkspaceError(root, candidatePath);
  }

  if (relativePath.length === 0) {
    return '.';
  }

  return relativePath.split(sep).join('/');
}

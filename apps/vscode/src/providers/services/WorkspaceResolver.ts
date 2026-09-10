import { getWorkspaceFolders } from '@brud/vscode-adapter';

export class WorkspaceResolver {
  constructor(
    private resolver: () => string[] = getWorkspaceFolders,
  ) {}

  getRoot(): string | undefined {
    const folders = this.resolver();
    return folders.length > 0 ? folders[0] : undefined;
  }

  hasWorkspace(): boolean {
    return this.resolver().length > 0;
  }

  getAll(): string[] {
    return this.resolver();
  }
}
/**
 * Builds the strict namespaced context bag used by kernel tests.
 *
 * Every service owns one root field. Tests that boot more than one service can
 * use the full bag; extra declared fields are harmless.
 */
export function workspaceContextOptions(
  workspaceRoot: string,
): Record<string, unknown> {
  return {
    'workspace.root': workspaceRoot,
    'settings.root': workspaceRoot,
    'filesystem.root': workspaceRoot,
    'terminal.root': workspaceRoot,
    'pluginManager.root': workspaceRoot,
    'history.root': workspaceRoot,
    'router.root': workspaceRoot,
  };
}

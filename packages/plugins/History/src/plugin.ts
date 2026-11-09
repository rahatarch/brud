import type { IBrudPlugin, IPluginContext, IPluginHistoryService } from '@brud/kernel';
import {
  HISTORY_DELETE_AUDIT_LOG_ACTION,
  HISTORY_DELETE_AUDIT_LOG_SCHEMA,
  HISTORY_GET_SNAPSHOTS_ACTION,
  HISTORY_GET_SNAPSHOTS_SCHEMA,
  HISTORY_LIST_SESSIONS_ACTION,
  HISTORY_LIST_SESSIONS_SCHEMA,
  HISTORY_PERMANENT_DELETE_ACTION,
  HISTORY_PERMANENT_DELETE_SCHEMA,
  HISTORY_RESTORE_SESSION_ACTION,
  HISTORY_RESTORE_SESSION_SCHEMA,
  HISTORY_REVERT_AUDIT_LOG_ACTION,
  HISTORY_REVERT_AUDIT_LOG_SCHEMA,
  HISTORY_REVERT_OPERATIONS_ACTION,
  HISTORY_REVERT_OPERATIONS_SCHEMA,
  HISTORY_REVERT_SESSION_ACTION,
  HISTORY_REVERT_SESSION_SCHEMA,
  HISTORY_TRASH_SESSION_ACTION,
  HISTORY_TRASH_SESSION_SCHEMA,
  HISTORY_WIPE_ALL_ACTION,
  HISTORY_WIPE_ALL_SCHEMA,
  historyDeleteAuditLog,
  historyGetSnapshots,
  historyListSessions,
  historyPermanentDelete,
  historyRestoreSession,
  historyRevertAuditLog,
  historyRevertOperations,
  historyRevertSession,
  historyTrashSession,
  historyWipeAll,
} from './groups/historyActions/index.js';
import {
  LIST_SESSIONS_TOOL,
  LIST_SESSIONS_TOOL_SCHEMA,
  REVERT_OPERATIONS_TOOL,
  REVERT_OPERATIONS_TOOL_SCHEMA,
  REVERT_SESSION_TOOL,
  REVERT_SESSION_TOOL_SCHEMA,
  listSessions,
  revertOperations,
  revertSession,
} from './groups/historyTools/index.js';
import { manifest } from './manifest.js';

function resolveHistory(context: IPluginContext): IPluginHistoryService | undefined {
  try {
    return context.getUniversalHistory();
  } catch (error) {
    context.logger.warn(
      'History is unavailable; History tools and actions were not registered.',
      { pluginId: context.pluginId, error: error instanceof Error ? error.message : String(error) },
    );

    return undefined;
  }
}

export function createHistoryPlugin(): IBrudPlugin {
  return {
    manifest,
    activate(context: IPluginContext): void {
      const history = resolveHistory(context);

      if (history === undefined) {
        return;
      }

      context.registerTool({
        name: REVERT_SESSION_TOOL,
        description: 'Revert an entire completed session to its pre- or post-state',
        parametersSchema: REVERT_SESSION_TOOL_SCHEMA,
        execute: (input, executionContext) =>
          revertSession(input, history, executionContext),
      });

      context.registerTool({
        name: REVERT_OPERATIONS_TOOL,
        description: 'Revert only the selected operations within a session',
        parametersSchema: REVERT_OPERATIONS_TOOL_SCHEMA,
        execute: (input, executionContext) =>
          revertOperations(input, history, executionContext),
      });

      context.registerTool({
        name: LIST_SESSIONS_TOOL,
        description: 'List recorded history sessions with optional filters',
        parametersSchema: LIST_SESSIONS_TOOL_SCHEMA,
        execute: (input, executionContext) =>
          listSessions(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_REVERT_SESSION_ACTION,
        description: 'Revert an entire completed session to its pre- or post-state',
        parametersSchema: HISTORY_REVERT_SESSION_SCHEMA,
        execute: (input, executionContext) =>
          historyRevertSession(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_REVERT_OPERATIONS_ACTION,
        description: 'Revert only the selected operations within a session',
        parametersSchema: HISTORY_REVERT_OPERATIONS_SCHEMA,
        execute: (input, executionContext) =>
          historyRevertOperations(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_LIST_SESSIONS_ACTION,
        description: 'List recorded history sessions with optional filters',
        parametersSchema: HISTORY_LIST_SESSIONS_SCHEMA,
        execute: (input, executionContext) =>
          historyListSessions(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_GET_SNAPSHOTS_ACTION,
        description: 'Read the sanitized snapshot of one history session',
        parametersSchema: HISTORY_GET_SNAPSHOTS_SCHEMA,
        execute: (input, executionContext) =>
          historyGetSnapshots(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_TRASH_SESSION_ACTION,
        description: 'Move a completed session to the trash',
        parametersSchema: HISTORY_TRASH_SESSION_SCHEMA,
        execute: (input, executionContext) =>
          historyTrashSession(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_RESTORE_SESSION_ACTION,
        description: 'Restore a trashed session',
        parametersSchema: HISTORY_RESTORE_SESSION_SCHEMA,
        execute: (input, executionContext) =>
          historyRestoreSession(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_PERMANENT_DELETE_ACTION,
        description: 'Permanently delete one session with its entries',
        parametersSchema: HISTORY_PERMANENT_DELETE_SCHEMA,
        execute: (input, executionContext) =>
          historyPermanentDelete(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_WIPE_ALL_ACTION,
        description: 'Permanently wipe every session after the exact confirmation phrase',
        parametersSchema: HISTORY_WIPE_ALL_SCHEMA,
        execute: (input, executionContext) =>
          historyWipeAll(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_REVERT_AUDIT_LOG_ACTION,
        description: 'List the session lifecycle audit log',
        parametersSchema: HISTORY_REVERT_AUDIT_LOG_SCHEMA,
        execute: (input, executionContext) =>
          historyRevertAuditLog(input, history, executionContext),
      });

      context.registerAction({
        name: HISTORY_DELETE_AUDIT_LOG_ACTION,
        description: 'Delete matching session lifecycle audit events',
        parametersSchema: HISTORY_DELETE_AUDIT_LOG_SCHEMA,
        execute: (input, executionContext) =>
          historyDeleteAuditLog(input, history, executionContext),
      });

      context.logger.info('History tools and actions registered', {
        tools: [REVERT_SESSION_TOOL, REVERT_OPERATIONS_TOOL, LIST_SESSIONS_TOOL],
        actions: [
          HISTORY_REVERT_SESSION_ACTION,
          HISTORY_REVERT_OPERATIONS_ACTION,
          HISTORY_LIST_SESSIONS_ACTION,
          HISTORY_GET_SNAPSHOTS_ACTION,
          HISTORY_TRASH_SESSION_ACTION,
          HISTORY_RESTORE_SESSION_ACTION,
          HISTORY_PERMANENT_DELETE_ACTION,
          HISTORY_WIPE_ALL_ACTION,
          HISTORY_REVERT_AUDIT_LOG_ACTION,
          HISTORY_DELETE_AUDIT_LOG_ACTION,
        ],
      });
    },
  };
}

export const plugin: IBrudPlugin = createHistoryPlugin();

export default plugin;
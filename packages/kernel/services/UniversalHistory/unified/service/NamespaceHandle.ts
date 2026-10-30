/**
 * Namespace-bound history handle (D3, D10). The namespace is captured in a
 * closure: writes always use it, reads are filtered to it, and `brud.core.*`
 * entries are never visible. The handle is a frozen object of functions, so no
 * property leads back to the service.
 */
import type { EntryPage, EntryQuery, EntryRow, SessionRow } from '../store/types.js';
import { UnifiedNamespaceError } from './errors.js';
import type { UnifiedHistoryService } from './UnifiedHistoryService.js';
import type { Disposable, EntryRecordInput, EntryTypeRegistration, NamespaceHistoryHandle } from './types.js';

export function createNamespaceHandle(service: UnifiedHistoryService, namespace: string): NamespaceHistoryHandle {
  const origin = `plugin:${namespace}`;

  const ownSession = (sessionId: string): SessionRow => {
    const row = service.store.getSession(sessionId);
    if (row === undefined || row.origin !== origin) {
      throw new UnifiedNamespaceError(`Session ${sessionId} does not belong to namespace "${namespace}"`);
    }
    return row;
  };

  const ownEntry = (entry: EntryRow): EntryRow => {
    if (entry.namespace !== namespace) {
      throw new UnifiedNamespaceError(`Entry ${entry.entryId} does not belong to namespace "${namespace}"`);
    }
    return entry;
  };

  const handle: NamespaceHistoryHandle = {
    namespace,
    registerEntryType: (registration: EntryTypeRegistration): Disposable =>
      service.registerEntryType(namespace, registration, origin),
    beginSession: (prompt: string): Promise<string> => service.beginSession(prompt, { origin }),
    recordEntry: async (sessionId: string, entry: EntryRecordInput): Promise<number> => {
      ownSession(sessionId);
      return service.recordEntry(namespace, sessionId, entry);
    },
    commitSession: async (sessionId: string, outcome: 'completed' | 'aborted'): Promise<void> => {
      ownSession(sessionId);
      await service.commitSession(sessionId, outcome);
    },
    getSession: (sessionId: string): SessionRow | undefined => {
      const row = service.store.getSession(sessionId);
      return row !== undefined && row.origin === origin ? row : undefined;
    },
    listSessions: (limit = 100): readonly SessionRow[] => {
      const rows: SessionRow[] = [];
      let page = service.listSessions({ limit: 1000 });
      for (;;) {
        rows.push(...page.rows.filter((row) => row.origin === origin));
        if (rows.length >= limit || page.next === undefined) {
          return rows.slice(0, limit);
        }
        page = service.listSessions({ limit: 1000, before: page.next });
      }
    },
    listEntries: (query: Omit<EntryQuery, 'namespace' | 'path'> = {}): EntryPage => {
      const safe = { ...query } as EntryQuery & { namespace?: unknown; path?: unknown };
      delete safe.namespace;
      delete safe.path;
      return service.listEntries({ ...safe, namespace });
    },
    resolvePayload: async (entry: EntryRow): Promise<unknown> => service.resolvePayload(ownEntry(entry)),
  };

  return Object.freeze(handle);
}

import { defineParticipant, type ParticipantContext } from '@brud/sdk/participant';
import type {
  DatabaseConfig,
  DbExposure,
  SecretsExposure,
} from './contracts/types.js';
import { DatabaseService } from './core/DatabaseService.js';

export const createService = defineParticipant<DatabaseService>({
  id: 'brud.db',
  description: 'Storage and secrets participant for BrudOS',
  tier: 'userland',
  requests: [],

  exposes: {
    'brud.db': {
      version: 1,
      scope: 'any',
      policy: { policyVersion: 2 },
      handle: (caller, ctx): DbExposure => {
        const callerId = caller.identity ?? (caller as { callerId?: string }).callerId;
        const namespace = ctx.instance.getNamespace(callerId ?? undefined);

        return {
          get: (key: string) => ctx.instance.get(namespace, key),
          set: (key: string, value: unknown) => ctx.instance.set(namespace, key, value),
          delete: (key: string) => ctx.instance.delete(namespace, key),
          has: (key: string) => ctx.instance.has(namespace, key),
          list: (prefix?: string) => ctx.instance.list(namespace, prefix),
          update: <T extends Record<string, unknown>>(key: string, patch: Partial<T>) =>
            ctx.instance.update<T>(namespace, key, patch),
        };
      },
    },

    'brud.secrets': {
      version: 1,
      scope: 'runtime',
      policy: { policyVersion: 2 },
      handle: (caller, ctx): SecretsExposure => {
        const callerId = caller.identity ?? (caller as { callerId?: string }).callerId;
        const namespace = ctx.instance.getNamespace(callerId ?? undefined);

        return {
          get: (key: string) => ctx.instance.getSecret(namespace, key),
          set: (key: string, plaintext: string, metadata?: Readonly<Record<string, unknown>>) =>
            ctx.instance.setSecret(namespace, key, plaintext, metadata),
          delete: (key: string) => ctx.instance.deleteSecret(namespace, key),
          has: (key: string) => ctx.instance.hasSecret(namespace, key),
          list: () => ctx.instance.listSecrets(namespace),
        };
      },
    },
  },

  create: (ctx: ParticipantContext<DatabaseService>): DatabaseService => {
    const config: DatabaseConfig = {
      driver: ((ctx.options['db.driver'] ?? ctx.bootOptions['db.driver']) as 'memory' | 'file' | 'sqlite') ?? 'memory',
      path: (ctx.options['db.path'] ?? ctx.bootOptions['db.path']) as string | undefined,
      encryptionKey: (ctx.options['db.encryptionKey'] ?? ctx.bootOptions['db.encryptionKey']) as string | undefined,
    };
    return new DatabaseService(config);
  },

  onRunning: async (ctx: ParticipantContext<DatabaseService>): Promise<void> => {
    await ctx.instance.initialize();
  },
});

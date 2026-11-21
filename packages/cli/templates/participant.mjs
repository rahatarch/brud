import { defineParticipant, byCapability } from '@brud/sdk/participant';
export const createService = defineParticipant({
  id: 'acme.vault',
  create: () => ({ secret: 's3cret' }),
  exposes: {
    'acme.vault': {
      scope: 'any',
      handle: byCapability({
        'vault:read': (ctx) => ({ read: () => ctx.instance.secret }),
        'vault:write': (ctx) => ({ write: (v) => { ctx.instance.secret = v; } }),
      }),
    },
  },
});

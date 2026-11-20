import { defineParticipant } from '@brud/sdk/participant';

export const createService = defineParticipant({
  id: 'acme.shout',
  create: () => ({}),
  exposes: {
    'acme.shout': {
      scope: 'any',
      handle: (_caller, ctx) => ({
        shout: (name) => {
          // Resolve the other giver when you need it, as this participant.
          const greeter = ctx.resolve('acme.greet');

          if (greeter === null) {
            throw new Error('the greeter refused us');
          }

          return greeter.greet(name).toUpperCase();
        },
      }),
    },
  },
});

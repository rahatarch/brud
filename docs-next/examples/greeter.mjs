import { defineParticipant } from '@brud/sdk/participant';

class Greeter {
  greet(name) {
    return `hello, ${name}`;
  }
}

export const createService = defineParticipant({
  id: 'acme.greeter',
  description: 'Says hello',
  create: () => new Greeter(),
  exposes: {
    'acme.greet': {
      version: 1,
      scope: 'any',
      handle: (caller, ctx) => ({
        greet: (name) => `${ctx.instance.greet(name)} (asked by ${caller.callerClass})`,
      }),
    },
  },
});

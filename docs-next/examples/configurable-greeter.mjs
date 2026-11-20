import { defineParticipant } from '@brud/sdk/participant';

const define = defineParticipant({
  id: 'acme.configurable',
  create: (ctx) => {
    // Startup options the host passed to bootKernel arrive in ctx.bootOptions.
    const greeting = String(ctx.bootOptions['acme.greeting'] ?? 'hello');

    return { greet: (name) => `${greeting}, ${name}` };
  },
  exposes: {
    'acme.configurable': {
      scope: 'any',
      handle: (_caller, ctx) => ({ greet: (name) => ctx.instance.greet(name) }),
    },
  },
});

export function createService(context) {
  // Declare the startup field this participant needs, inside its own namespace.
  context.declareContextFields('acme', [
    {
      name: 'acme.greeting',
      type: 'string',
      required: true,
      description: 'The word used to greet people.',
    },
  ]);

  return define(context);
}

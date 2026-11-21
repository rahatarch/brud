import { createServiceToken, withExposureBindings } from '@brud/kernel';

const token = createServiceToken('acme.notes', 'A tiny notebook');
const notes = [];

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.notes.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
      kinds: [{
        kind: 'note',
        exposure: 'acme.notes.dispatch',
        description: 'Keep short notes',
        operations: {
          add: { description: 'Add a note', input: { type: 'object', properties: { text: { type: 'string' } } } },
          list: { description: 'List every note' },
        },
      }],
    },
    factory: () => withExposureBindings({}, {
      'acme.notes.dispatch@1': {
        projection: () => ({
          dispatch: async (operation, context) => {
            if (operation.name === 'add') {
              notes.push(String(operation.parameters.text ?? ''));
              return { status: 'success', data: { count: notes.length } };
            }
            if (operation.name === 'list') {
              return { status: 'success', data: { notes: [...notes], asked_by: context.caller.origin } };
            }
            return { status: 'failed', error: `note cannot ${operation.name}` };
          },
        }),
      },
    }),
  };
}

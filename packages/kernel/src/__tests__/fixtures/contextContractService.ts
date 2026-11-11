import type { KernelServiceModuleContext } from '../../bootstrap/bootTypes.js';
import type { ContextFieldDeclaration } from '../../contracts/contextContract.js';

interface FixtureScopeDeclaration {
  readonly scope: string;
  readonly fields: readonly ContextFieldDeclaration[];
}

/**
 * Test-only service module that declares whatever the host asks for.
 *
 * Declarations travel in the options bag so a single module can exercise
 * independent namespaces without teaching the core any concrete field.
 */
export function createService(context: KernelServiceModuleContext) {
  const declarations = context.options['__contractDeclarations'];

  if (Array.isArray(declarations)) {
    for (const declaration of declarations as readonly FixtureScopeDeclaration[]) {
      context.declareContextFields(declaration.scope, declaration.fields);
    }
  }

  return {
    token: {
      id: 'test.context.contract',
      description: 'Dynamic context contract fixture',
      _brand: [] as unknown,
    },
    tier: 'core' as const,
    dependencies: [],
    factory: () => ({
      declare: (scope: string, fields: readonly ContextFieldDeclaration[]): void => {
        context.declareContextFields(scope, fields);
      },
      schema: () => context.getContextSchema(),
    }),
  };
}
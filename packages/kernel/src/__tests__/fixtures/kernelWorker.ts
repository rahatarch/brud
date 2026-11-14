import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStandardKernel } from '../support/standardKernel.js';
import { BrudToolsToken } from '../../../../services/BrudTools/descriptor/tokens.js';
import type { IBrudPlugin } from '../../../../services/PluginManager/contracts/IBrudPlugin.js';
import { workspaceContextOptions } from '../support/workspaceContext.js';

const [workspaceRoot, workerId, outbox] = process.argv.slice(2);

if (workspaceRoot === undefined || workerId === undefined || outbox === undefined) {
  throw new Error('kernelWorker requires workspaceRoot, workerId and outbox arguments');
}

const plugin: IBrudPlugin = {
  manifest: {
    id: `acme.worker.${workerId}`,
    name: `worker-${workerId}`,
    version: '1.0.0',
    permissions: ['tools:register', 'tools:execute', 'fs:read', 'fs:write'],
  },
  activate: (context): void => {
    context.registerTool({
      name: 'shared.tool',
      description: 'worker tool',
      parametersSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      requiredPermissions: ['fs:read', 'fs:write'],
      execute: async (input) => {
        const fs = context.getFileSystem();
        await fs.writeAtomic(`worker-${workerId}.txt`, String(input.value));
        return { status: 'success', data: { workerId, value: input.value } };
      },
    });
  },
};

const kernel = createStandardKernel({
  history: { dbPath: join(workspaceRoot, '.brud', 'history', 'universal.db') },
  'pluginManager.plugins': { entries: [plugin] },
});

await kernel.boot({ options: workspaceContextOptions(workspaceRoot) });

const tools = kernel.requestAccess(
  { callerId: `worker.${workerId}`, tier: 'core', options: workspaceContextOptions(workspaceRoot) },
  BrudToolsToken,
);

const result = await tools.executeTool(
  'shared.tool',
  { value: `from-${workerId}` },
  { workspaceRoot, callerId: `worker.${workerId}`, permissions: ['fs:read', 'fs:write'] },
);

await writeFile(outbox, JSON.stringify({ workerId, result }), 'utf8');
await kernel.shutdown();

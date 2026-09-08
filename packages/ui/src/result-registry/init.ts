import { globalRegistry } from './registry';
import { structureRenderer } from './renderers/structureRenderer';
import { readRenderer } from './renderers/readRenderer';
import { searchRenderer } from './renderers/searchRenderer';
import { metadataRenderer } from './renderers/metadataRenderer';
import { terminalRenderer } from './renderers/terminalRenderer';
import { toolInfoRenderer } from './renderers/toolInfoRenderer';
import { errorRenderer } from './renderers/errorRenderer';
import { operationResultRenderer } from './renderers/operationResultRenderer';

const OPERATION_RESULT_KINDS = [
  'search_replace',
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'copy_file',
  'append_file',
  'append_file_multi',
  'search_replace_multi',
  'create_directory',
  'delete_directory',
  'move_directory',
  'terminal_interactive',
];

export function initResultRegistry(): void {
  globalRegistry.registerRenderer(structureRenderer);
  globalRegistry.registerRenderer(readRenderer);
  globalRegistry.registerRenderer(searchRenderer);
  globalRegistry.registerRenderer(metadataRenderer);
  globalRegistry.registerRenderer(terminalRenderer);
  globalRegistry.registerRenderer(toolInfoRenderer);
  globalRegistry.registerRenderer(errorRenderer);

  for (const kind of OPERATION_RESULT_KINDS) {
    globalRegistry.registerRenderer({ ...operationResultRenderer, toolKind: kind });
  }
}
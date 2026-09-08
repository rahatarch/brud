import { globalRegistry } from './registry';
import { structureRenderer } from './renderers/structureRenderer';
import { readRenderer } from './renderers/readRenderer';
import { searchRenderer } from './renderers/searchRenderer';
import { metadataRenderer } from './renderers/metadataRenderer';
import { terminalRenderer } from './renderers/terminalRenderer';
import { toolInfoRenderer } from './renderers/toolInfoRenderer';
import { errorRenderer } from './renderers/errorRenderer';

export function initResultRegistry(): void {
  globalRegistry.registerRenderer(structureRenderer);
  globalRegistry.registerRenderer(readRenderer);
  globalRegistry.registerRenderer(searchRenderer);
  globalRegistry.registerRenderer(metadataRenderer);
  globalRegistry.registerRenderer(terminalRenderer);
  globalRegistry.registerRenderer(toolInfoRenderer);
  globalRegistry.registerRenderer(errorRenderer);
}
import { globalRegistry } from './registry';
import { structureRenderer } from './renderers/structureRenderer';
import { readRenderer } from './renderers/readRenderer';
import { searchRenderer } from './renderers/searchRenderer';
import { metadataRenderer } from './renderers/metadataRenderer';

export function initResultRegistry(): void {
  globalRegistry.registerRenderer(structureRenderer);
  globalRegistry.registerRenderer(readRenderer);
  globalRegistry.registerRenderer(searchRenderer);
  globalRegistry.registerRenderer(metadataRenderer);
}
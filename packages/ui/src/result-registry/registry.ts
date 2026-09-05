import { ToolResultRenderer } from './types';

export class ToolResultRegistry {
  private renderers = new Map<string, ToolResultRenderer>();

  registerRenderer(renderer: ToolResultRenderer): void {
    this.renderers.set(renderer.toolKind, renderer);
  }

  getRenderer(toolKind: string): ToolResultRenderer | undefined {
    return this.renderers.get(toolKind);
  }

  getAllRenderers(): ToolResultRenderer[] {
    return Array.from(this.renderers.values());
  }
}

export const globalRegistry = new ToolResultRegistry();
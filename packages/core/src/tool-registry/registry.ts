import type { ToolDoc } from './types';

export class ToolRegistry {
  private tools = new Map<string, ToolDoc>();

  registerTool(doc: ToolDoc): void {
    this.tools.set(doc.kind, doc);
  }

  getTool(kind: string): ToolDoc | undefined {
    return this.tools.get(kind);
  }

  getAllTools(): ToolDoc[] {
    return Array.from(this.tools.values());
  }
}

export const globalToolRegistry = new ToolRegistry();
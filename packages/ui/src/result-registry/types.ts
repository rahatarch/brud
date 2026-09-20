import { ReactNode } from 'react';

export interface ToolResultRenderer {
  toolKind: string;
  title: string;
  canRender: (data: any) => boolean;
  renderSection: (data: any) => ReactNode;
  copyFormatter: (data: any) => string;
  summaryFormatter?: (data: any) => string;
}
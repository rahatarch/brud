import { ReactNode } from 'react';

export interface ToolResultRenderer {
  toolKind: string;
  title: string;
  renderSection: (data: any) => ReactNode;
  copyFormatter: (data: any) => string;
}
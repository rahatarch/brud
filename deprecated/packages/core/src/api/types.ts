export interface ValidationResult {
  success: boolean;
  code?: string;
  friendly?: string;
  details?: string;
  data?: unknown;
}

export interface BrudError {
  code: string;
  friendly: string;
  details: string;
  message?: string;
  path?: string;
  command?: string;
  operationKind?: string;
  exitCode?: number | null;
}
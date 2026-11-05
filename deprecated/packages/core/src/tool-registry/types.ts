export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface ToolDoc {
  kind: string;
  name: string;
  description: string;
  marker: string;
  parameters: ToolParameter[];
  example: string;
  rules: string[];
}
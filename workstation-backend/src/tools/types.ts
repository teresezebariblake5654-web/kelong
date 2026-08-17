export interface ToolContext {
  filePath?: string;
  fileName?: string;
  taskDescription?: string;
  parsedData?: unknown;
}

export interface ToolResult {
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

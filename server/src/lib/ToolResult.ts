export type McpToolResult = {
  jsonrpc: '2.0';
  id: string;
  result: {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: Record<string, unknown>;
    isError: boolean;
  };
};

export function createMcpToolResult(toolCallId: string, resultData: unknown, isError = false): McpToolResult {
  const structuredContent = resultData && typeof resultData === 'object' && !Array.isArray(resultData)
    ? resultData as Record<string, unknown>
    : { value: resultData };
  return {
    jsonrpc: '2.0',
    id: toolCallId,
    result: {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
      isError,
    },
  };
}

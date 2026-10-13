/**
 * MCP Bridge Types
 *
 * Purpose: TypeScript interfaces for the MCP bridge request/response protocol —
 *   defines event fields flowing between Rust and frontend handlers, including
 *   the server-assigned WebSocket client id used for isolated approvals.
 *
 * @module services/mcpBridge/types
 */

/** Raw event from Tauri IPC - args is JSON string to avoid double-encoding */
export interface McpRequestEventRaw {
  id: string;
  type: string;
  /** Server-minted id of the authenticated WebSocket connection. */
  client_id?: string;
  /** Camel case (Tauri may convert serialized fields). */
  clientId?: string;
  /** Snake case (as defined in Rust) */
  args_json?: string;
  /** CamelCase (Tauri might convert) */
  argsJson?: string;
}

/** Parsed event with args as object */
export interface McpRequestEvent {
  id: string;
  type: string;
  args: Record<string, unknown>;
  clientId?: string;
}

/** Response sent back to Rust after an MCP bridge handler completes. */
export interface McpResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

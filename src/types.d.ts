// Define types for agents/mcp
declare module "agents/mcp" {
  export class McpAgent {
    constructor(state: DurableObjectState, env: any);
    env: any;
    initialized: boolean;
    handleSse(request: Request): Promise<Response>;
    handleMcp(request: Request): Promise<Response>;
  }
}

// Define types for @modelcontextprotocol/sdk/server/mcp.js
declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(options: { name: string; version: string });
    tool(name: string, schema: any, handler: (args: any) => Promise<any>): void;
  }
}

// Declare types for missing DurableObjectState if not defined by Cloudflare Workers
interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectStorage {
  get(key: string): Promise<any>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<boolean>;
} 
# COMPLiQ MCP Server on Cloudflare

This project implements a Model Context Protocol (MCP) server for COMPLiQ on Cloudflare Workers. The server enables AI assistants to interact with the COMPLiQ platform through MCP tools.

## What is COMPLiQ?

COMPLiQ is a platform that logs prompts, attached files, intermediate results, and responses from user interactions with AI models. It provides a standardized API for recording these interactions.

## Features

The MCP server provides the following tools that correspond to COMPLiQ's API endpoints:

1. **inputPrompt** - Submit a prompt/request to COMPLiQ (Mandatory)
2. **addFile** - Attach a file to a request (Optional)
3. **intermediateResults** - Send intermediate processing results (Optional)
4. **processingResult** - Submit the final processing result/answer (Mandatory)

## Setup

1. Clone this repository
2. Configure your API key in `wrangler.jsonc` or using environment secrets:
   ```
   npx wrangler secret put COMPLIQ_API_KEY
   ```
3. Deploy the worker:
   ```
   npm run deploy
   ```

## Connecting to the MCP Server

Once deployed, your MCP server will be available at:
```
https://compliq-mcp-server.<your-account>.workers.dev/sse
```

You can connect to it using an MCP client like Claude Desktop by adding this configuration:
```json
{
  "mcpServers": {
    "compliq": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://compliq-mcp-server.<your-account>.workers.dev/sse"
      ]
    }
  }
}
```

## API Endpoints

The COMPLiQ API endpoints used by this server are:

- `https://ai-stage-be.compliq.io/v1/actions/task-input`
- `https://ai-stage-be.compliq.io/v1/actions/file-input`
- `https://ai-stage-be.compliq.io/v1/actions/resources-used`
- `https://ai-stage-be.compliq.io/v1/actions/output`

## Developer Documentation

For more information about the COMPLiQ API, refer to the API documentation.

For more details about the Model Context Protocol, visit [modelcontextprotocol.io](https://modelcontextprotocol.io).

// @ts-ignore: Dynamic imports for Cloudflare Workers
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// @ts-ignore: Dynamic imports for Cloudflare Workers
import { z } from "zod";

// Import Cloudflare Worker types
import type { 
		DurableObjectNamespace, 
		DurableObjectState,
		ExecutionContext
} from '@cloudflare/workers-types';

// Define the environment interface
export interface Env {
	COMPLIQ_API_KEY: string;
	MCP_OBJECT: DurableObjectNamespace;
}

// Define our MCP Durable Object class
export class MyMCP {
	server: any;
	state: DurableObjectState;
	env: Env;
	initialized = false;
	sseClients = new Set<{ writer: WritableStreamDefaultWriter, interval: any }>();
	private msSinceEpoch = Date.now();

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		// Initialize the server with name and version
		this.server = new McpServer({
			name: "COMPLiQ MCP Server",
			version: "1.0.0",
		});
		console.log(`MyMCP instance created at ${new Date().toISOString()}`);
	}

	async fetch(request: Request): Promise<Response> {
		// Log basic request info
		console.log(`DO received ${request.method} request to ${new URL(request.url).pathname}`);
		
		// Initialize server if not already done
		if (!this.initialized) {
			console.log("Server not yet initialized, initializing now...");
			try {
				await this.initServer();
				this.initialized = true;
				console.log("Server initialization completed successfully");
			} catch (error) {
				console.error("Server initialization failed:", error);
				return new Response(`Server initialization failed: ${error}`, { status: 500 });
			}
		}
		
		// Add CORS headers if this is an OPTIONS request
		if (request.method === "OPTIONS") {
			return this.handleCors();
		}

		// Add CORS headers to all responses
		const url = new URL(request.url);
		
		// Handle SSE connections
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			console.log("Handling SSE connection request");
			try {
				const response = await this.handleSse(request);
				return this.addCorsHeaders(response);
			} catch (error) {
				console.error("Error handling SSE request:", error);
				return this.addCorsHeaders(
					new Response(`SSE error: ${error}`, { status: 500 })
				);
			}
		}
		
		// Handle MCP requests
		if (url.pathname === "/mcp") {
			console.log("Handling MCP request");
			try {
				const response = await this.handleMcp(request);
				return this.addCorsHeaders(response);
			} catch (error) {
				console.error("Error handling MCP request:", error);
				return this.addCorsHeaders(
					new Response(`MCP error: ${error}`, { status: 500 })
				);
			}
		}
		
		// Return 404 for other paths
		return this.addCorsHeaders(new Response("Not found", { status: 404 }));
	}

	async handleSse(request: Request): Promise<Response> {
		console.log("Setting up SSE connection");
		try {
			// Create a transform stream for the SSE connection
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const encoder = new TextEncoder();
			
			// Generate a unique client ID for logging
			const clientId = Math.random().toString(36).substring(2, 10);
			console.log(`SSE: New client ${clientId} connected`);
			
			// Send initial connection message immediately
			await writer.write(encoder.encode(`event: connected\ndata: {"clientId":"${clientId}"}\n\n`));
			
			// Create a message handler
			const sseHandler = {
				send: async (event: string, data: any) => {
					try {
						console.log(`SSE: Sending event ${event} to client ${clientId}`);
						const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
						await writer.write(encoder.encode(message));
					} catch (error) {
						console.error(`SSE: Error sending event to client ${clientId}:`, error);
					}
				}
			};
			
			// Register this connection with the MCP server
			try {
				// Forward SSE requests to the MCP server
				this.server.addSseClient(sseHandler);
				console.log(`SSE: Client ${clientId} registered with MCP server`);
			} catch (error) {
				console.error(`SSE: Error registering client with MCP server: ${error}`);
				// We'll continue anyway
			}
			
			// Set up frequent heartbeats to keep the connection alive
			// We send heartbeats every 5 seconds to prevent timeouts
			const heartbeatInterval = setInterval(async () => {
				try {
					const timestamp = new Date().toISOString();
					const uptime = Date.now() - this.msSinceEpoch;
					await writer.write(encoder.encode(`event: heartbeat\ndata: {"timestamp":"${timestamp}","uptime":${uptime},"clientId":"${clientId}"}\n\n`));
				} catch (error) {
					console.error(`SSE: Heartbeat failed for client ${clientId}:`, error);
					this.cleanupClient(writer, heartbeatInterval, clientId);
				}
			}, 5000); // Send heartbeats every 5 seconds
			
			// Add this client to our tracked set
			const client = { writer, interval: heartbeatInterval };
			this.sseClients.add(client);
			console.log(`SSE: Client ${clientId} added to tracking. Active clients: ${this.sseClients.size}`);
			
			// Set up cleanup when the connection closes
			request.signal.addEventListener('abort', () => {
				console.log(`SSE: Client ${clientId} connection aborted by browser`);
				try {
					// Remove from MCP server to stop receiving events
					this.server.removeSseClient(sseHandler);
				} catch (error) {
					console.error(`SSE: Error removing client from MCP server: ${error}`);
				}
				this.cleanupClient(writer, heartbeatInterval, clientId);
			});
			
			// Return the SSE response with appropriate headers
			return new Response(readable, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-store, no-transform',
					'Connection': 'keep-alive'
				}
			});
		} catch (error: any) {
			console.error("SSE setup error:", error);
			return new Response(`SSE setup error: ${error.message || String(error)}`, { 
				status: 500,
				headers: { "Content-Type": "text/plain" },
			});
		}
	}
	
	cleanupClient(writer: WritableStreamDefaultWriter, interval: any, clientId?: string) {
		// Log the cleanup
		console.log(`Cleaning up client ${clientId || 'unknown'}`);
		
		// Remove the client from our set 
		this.sseClients.forEach(client => {
			if (client.writer === writer) {
				clearInterval(client.interval);
				this.sseClients.delete(client);
				console.log(`Client ${clientId || 'unknown'} removed. Remaining clients: ${this.sseClients.size}`);
			}
		});
		
		// Close the writer
		try {
			writer.close().catch(e => console.error(`Error closing writer for client ${clientId || 'unknown'}:`, e));
		} catch (e) {
			console.error(`Error in writer close for client ${clientId || 'unknown'}:`, e);
		}
	}

	async handleMcp(request: Request): Promise<Response> {
		try {
			// Parse the request as JSON
			const body = await request.json();
			console.log(`MCP request received: method=${body.method}, id=${body.id}`);
			
			// Check if it's a describe request
			if (body.method === "describe") {
				// Return server description
				return new Response(JSON.stringify({
					jsonrpc: "2.0",
					result: {
						name: this.server.name,
						version: this.server.version,
						tools: this.server.getTools()
					},
					id: body.id
				}), {
					headers: { "Content-Type": "application/json" }
				});
			}
			
			// Check if it's a run request
			if (body.method === "run") {
				try {
					// Extract the tool name and params
					const toolName = body.params.tool;
					const toolParams = body.params.params;
					
					// Run the tool
					const toolHandler = this.server.getToolHandler(toolName);
					if (!toolHandler) {
						throw new Error(`Tool not found: ${toolName}`);
					}
					
					// Execute the tool
					const result = await toolHandler(toolParams);
					
					// Return the result
					return new Response(JSON.stringify({
						jsonrpc: "2.0",
						result,
						id: body.id
					}), {
						headers: { "Content-Type": "application/json" }
					});
				} catch (toolError: any) {
					console.error("Tool execution error:", toolError);
					return new Response(JSON.stringify({
						jsonrpc: "2.0",
						error: {
							code: -32000,
							message: toolError.message || "Tool execution failed",
							data: { stack: toolError.stack }
						},
						id: body.id
					}), {
						headers: { "Content-Type": "application/json" }
					});
				}
			}
			
			// Unsupported method
			return new Response(JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: -32601,
					message: `Method not found: ${body.method}`
				},
				id: body.id
			}), {
				headers: { "Content-Type": "application/json" }
			});
		} catch (error: any) {
			console.error("MCP parsing error:", error);
			// Return a malformed request error
			return new Response(JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: -32700,
					message: "Parse error",
					data: { details: error.message }
				},
				id: null
			}), { 
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}
	}

	handleCors(): Response {
		return new Response(null, {
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "*",
				"Access-Control-Max-Age": "86400",
			},
		});
	}

	addCorsHeaders(response: Response): Response {
		const headers = new Headers(response.headers);
		headers.set("Access-Control-Allow-Origin", "*");
		headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		headers.set("Access-Control-Allow-Headers", "*");
		headers.set("Access-Control-Max-Age", "86400");
		
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	}

	async initServer() {
		console.log("Initializing COMPLiQ MCP Server");
		
		// Check if API key is available
		try {
            const apiKey = this.env.COMPLIQ_API_KEY;
            if (typeof apiKey === 'string' && apiKey.length > 0) {
                console.log("API key exists and is valid");
            } else {
                console.warn("API key is missing or invalid!");
            }
        } catch (error) {
            console.error("Error accessing API key:", error);
        }
		
		// Initialize COMPLiQ MCP tools
		try {
			await this.initializeTools();
			console.log("Tools initialized successfully");
		} catch (error) {
			console.error("Error initializing tools:", error);
			throw error; // Re-throw to signal initialization failure
		}
	}
	
	async initializeTools() {
		console.log("Setting up COMPLiQ tools");
		
		// Input Prompt tool
		this.server.tool(
			"inputPrompt",
			{
				sessionId: z.string().max(100).describe("Session identifier"),
				correlationId: z.string().max(100).describe("Correlation ID"),
				content: z.string().max(40000).describe("User input prompt text"),
				userId: z.string().max(100).describe("User identifier"),
				timestamp: z.string().describe("Request timestamp (MM-DD-YYYY HH:MM:SS)"),
			},
			async ({ sessionId, correlationId, content, userId, timestamp }) => {
				console.log("Executing inputPrompt tool");
				try {
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("content", content);
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);

					// Get the API key from env
					const apiKey = this.env.COMPLIQ_API_KEY || "";
					if (!apiKey) {
						throw new Error("API key is not configured");
					}

					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/task-input", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${apiKey}`,
						},
						body: formData,
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error(`API Error (${response.status}):`, errorText);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					console.log("inputPrompt success:", result);
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("inputPrompt error:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Add File tool
		this.server.tool(
			"addFile",
			{
				sessionId: z.string().max(100).describe("Session identifier"),
				correlationId: z.string().max(100).describe("Correlation ID"),
				fileBase64: z.string().describe("Base64 encoded file data"),
				fileName: z.string().describe("Name of the file"),
				fileContentType: z.string().describe("Content type of the file (png, jpeg, mp3, mp4, docx, pdf, csv, xml, ogg)"),
				userId: z.string().max(100).optional().describe("User identifier"),
				timestamp: z.string().describe("Request timestamp (MM-DD-YYYY HH:MM:SS)"),
			},
			async ({ sessionId, correlationId, fileBase64, fileName, fileContentType, userId, timestamp }) => {
				console.log("Executing addFile tool");
				try {
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					
					// Convert base64 to file
					const binaryData = atob(fileBase64);
					const bytes = new Uint8Array(binaryData.length);
					for (let i = 0; i < binaryData.length; i++) {
						bytes[i] = binaryData.charCodeAt(i);
					}
					const blob = new Blob([bytes], { type: fileContentType });
					formData.append("file", blob, fileName);
					
					if (userId) {
						formData.append("userId", userId);
					}
					formData.append("timestamp", timestamp);
					
					// Get the API key from env
					const apiKey = this.env.COMPLIQ_API_KEY || "";
					if (!apiKey) {
						throw new Error("API key is not configured");
					}
					
					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/file-input", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${apiKey}`,
						},
						body: formData,
					});
					
					if (!response.ok) {
						const errorText = await response.text();
						console.error(`API Error (${response.status}):`, errorText);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}
					
					const result = await response.json();
					console.log("addFile success:", result);
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("addFile error:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Intermediate Results tool
		this.server.tool(
			"intermediateResults",
			{
				sessionId: z.string().max(100).describe("Session identifier"),
				correlationId: z.string().max(100).describe("Correlation ID"),
				resourceName: z.string().describe("Name of the resource used"),
				content: z.string().max(40000).optional().describe("Resource response in plain text"),
				fileBase64: z.string().optional().describe("Base64 encoded file data"),
				fileName: z.string().optional().describe("Name of the file"),
				fileContentType: z.string().optional().describe("Content type of the file (png, jpeg, mp3, mp4, docx, pdf, csv, xml, ogg)"),
				userId: z.string().max(100).describe("User ID"),
				timestamp: z.string().describe("Intermediate result timestamp (MM-DD-YYYY HH:MM:SS)"),
			},
			async ({ sessionId, correlationId, resourceName, content, fileBase64, fileName, fileContentType, userId, timestamp }) => {
				console.log("Executing intermediateResults tool");
				try {
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("resourceName", resourceName);
					
					// Either content or file must be provided
					if (content) {
						formData.append("content", content);
					} else if (fileBase64 && fileName && fileContentType) {
						// Convert base64 to file
						const binaryData = atob(fileBase64);
						const bytes = new Uint8Array(binaryData.length);
						for (let i = 0; i < binaryData.length; i++) {
							bytes[i] = binaryData.charCodeAt(i);
						}
						const blob = new Blob([bytes], { type: fileContentType });
						formData.append("file", blob, fileName);
					} else {
						throw new Error("Either content or file information must be provided");
					}
					
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);
					
					// Get the API key from env
					const apiKey = this.env.COMPLIQ_API_KEY || "";
					if (!apiKey) {
						throw new Error("API key is not configured");
					}
					
					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/resources-used", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${apiKey}`,
						},
						body: formData,
					});
					
					if (!response.ok) {
						const errorText = await response.text();
						console.error(`API Error (${response.status}):`, errorText);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}
					
					const result = await response.json();
					console.log("intermediateResults success:", result);
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("intermediateResults error:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Processing Result tool
		this.server.tool(
			"processingResult",
			{
				sessionId: z.string().max(100).describe("Session identifier"),
				correlationId: z.string().max(100).describe("Correlation ID"),
				processingTime: z.string().describe("Time spent by the third-party system (HH:MM:SS)"),
				content: z.string().max(40000).optional().describe("Answer in plain text"),
				fileBase64: z.string().optional().describe("Base64 encoded file data"),
				fileName: z.string().optional().describe("Name of the file"),
				fileContentType: z.string().optional().describe("Content type of the file (png, jpeg, mp3, mp4, docx, pdf, csv, xml, ogg)"),
				userId: z.string().max(100).describe("User ID"),
				timestamp: z.string().describe("Final result timestamp (MM-DD-YYYY HH:MM:SS)"),
			},
			async ({ sessionId, correlationId, processingTime, content, fileBase64, fileName, fileContentType, userId, timestamp }) => {
				console.log("Executing processingResult tool");
				try {
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("processingTime", processingTime);
					
					// Either content or file must be provided
					if (content) {
						formData.append("content", content);
					} else if (fileBase64 && fileName && fileContentType) {
						// Convert base64 to file
						const binaryData = atob(fileBase64);
						const bytes = new Uint8Array(binaryData.length);
						for (let i = 0; i < binaryData.length; i++) {
							bytes[i] = binaryData.charCodeAt(i);
						}
						const blob = new Blob([bytes], { type: fileContentType });
						formData.append("file", blob, fileName);
					} else {
						throw new Error("Either content or file information must be provided");
					}
					
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);
					
					// Get the API key from env
					const apiKey = this.env.COMPLIQ_API_KEY || "";
					if (!apiKey) {
						throw new Error("API key is not configured");
					}
					
					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/output", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${apiKey}`,
						},
						body: formData,
					});
					
					if (!response.ok) {
						const errorText = await response.text();
						console.error(`API Error (${response.status}):`, errorText);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}
					
					const result = await response.json();
					console.log("processingResult success:", result);
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("processingResult error:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);
		
		console.log("All COMPLiQ tools initialized");
	}
}

// Worker entry point
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			console.log("Worker request:", request.method, url.pathname);
			
			// Handle CORS preflight
			if (request.method === "OPTIONS") {
				return new Response(null, {
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers": "*",
						"Access-Control-Max-Age": "86400",
					},
				});
			}
			
			// Health check endpoint
			if (url.pathname === "/health") {
				// Test to see if API key is accessible
				let apiKeyValue = "undefined";
				let apiKeyType = "undefined";
				let apiKeyFirstChars = null as string | null;
				
				try {
					apiKeyValue = env.COMPLIQ_API_KEY;
					apiKeyType = typeof apiKeyValue;
					
					if (apiKeyType === 'string' && apiKeyValue.length > 0) {
						apiKeyFirstChars = apiKeyValue.substring(0, 5) + "...";
					}
				} catch (error) {
					console.error("Error in health check:", error);
				}
				
				return new Response(
					JSON.stringify({
						status: "ok",
						timestamp: new Date().toISOString(),
						// Environment inspection
						envKeys: Object.keys(env),
						hasApiKeyInKeys: Object.keys(env).includes("COMPLIQ_API_KEY"),
						// API key inspection
						apiKeyType: apiKeyType,
						apiKeyLength: apiKeyType === 'string' ? apiKeyValue.length : 0,
						apiKeyFirstChars: apiKeyFirstChars,
						// MCP binding
						hasMcpObjectBinding: !!env.MCP_OBJECT
					}),
					{
						status: 200,
						headers: { 
							"Content-Type": "application/json",
							"Access-Control-Allow-Origin": "*",
							"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
							"Access-Control-Allow-Headers": "*",
						},
					}
				);
			}

			// Forward to the Durable Object
			if (url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname === "/sse/message") {
				// Create an ID for the Durable Object
				const doId = env.MCP_OBJECT.idFromName("singleton");
				// Get a stub to the specific Durable Object instance
				const doStub = env.MCP_OBJECT.get(doId);
				
				// Forward the request to the Durable Object
				return await doStub.fetch(request);
			}
			
			// Not found for all other paths
			return new Response("Not found", { 
				status: 404,
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "*",
				}
			});
		} catch (e: any) {
			console.error("Error in worker:", e);
			return new Response(`Server error: ${e.message || String(e)}`, { 
				status: 500,
				headers: { 
					"Content-Type": "text/plain",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "*",
				},
			});
		}
	},
};

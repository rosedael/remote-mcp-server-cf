// @ts-ignore: Dynamic imports for Cloudflare Workers
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// @ts-ignore: Dynamic imports for Cloudflare Workers
import { z } from "zod";

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

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
		this.server = new McpServer({
			name: "COMPLiQ MCP Server",
			version: "1.0.0",
		});
	}

	async fetch(request: Request): Promise<Response> {
		// Initialize server if not already done
		if (!this.initialized) {
			await this.initServer();
			this.initialized = true;
		}
		
		// Add CORS headers if this is an OPTIONS request
		if (request.method === "OPTIONS") {
			return this.handleCors();
		}

		// Add CORS headers to all responses
		const url = new URL(request.url);
		
		// Handle SSE connections
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			const response = await this.handleSse(request);
			return this.addCorsHeaders(response);
		}
		
		// Handle MCP requests
		if (url.pathname === "/mcp") {
			const response = await this.handleMcp(request);
			return this.addCorsHeaders(response);
		}
		
		// Return 404 for other paths
		return this.addCorsHeaders(new Response("Not found", { status: 404 }));
	}

	async handleSse(request: Request): Promise<Response> {
		try {
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			
			// Send initial SSE headers to client
			const encoder = new TextEncoder();
			await writer.write(encoder.encode("event: connected\ndata: connected\n\n"));
			
			// You would implement full SSE functionality here
			
			return new Response(readable, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"Connection": "keep-alive",
				},
			});
		} catch (error: any) {
			console.error("SSE error:", error);
			return new Response(`SSE error: ${error.message || String(error)}`, { 
				status: 500,
				headers: { "Content-Type": "text/plain" },
			});
		}
	}

	async handleMcp(request: Request): Promise<Response> {
		try {
			// Parse the request as JSON
			const body = await request.json();
			
			// Process the MCP request (basic mock response)
			const response = {
				status: "success",
				message: "MCP request processed",
				data: body
			};
			
			return new Response(JSON.stringify(response), {
				headers: { "Content-Type": "application/json" }
			});
		} catch (error: any) {
			console.error("MCP error:", error);
			return new Response(`MCP error: ${error.message || String(error)}`, { 
				status: 500,
				headers: { "Content-Type": "text/plain" },
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
		
		// Initialize COMPLiQ MCP tools
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
				try {
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("content", content);
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);

					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/task-input", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${this.env.COMPLIQ_API_KEY}`,
						},
						body: formData,
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
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
				// Implementation follows same pattern as inputPrompt
				return {
					content: [{ type: "text", text: "File upload simulation" }],
				};
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
				// Implementation follows same pattern as inputPrompt
				return {
					content: [{ type: "text", text: "Intermediate results simulation" }],
				};
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
				// Implementation follows same pattern as inputPrompt
				return {
					content: [{ type: "text", text: "Processing result simulation" }],
				};
			}
		);
		
		this.initialized = true;
		console.log("Server initialization complete");
	}
}

// Worker entry point
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			
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
				return new Response(
					JSON.stringify({
						status: "ok",
						timestamp: new Date().toISOString(),
						hasApiKey: !!env.COMPLIQ_API_KEY,
						hasMcpObjectBinding: !!env.MCP_OBJECT,
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

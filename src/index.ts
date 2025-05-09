import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
	COMPLIQ_API_KEY: string;
}

interface ToolParams {
	sessionId: string;
	correlationId: string;
	content?: string;
	userId: string;
	timestamp: string;
	fileBase64?: string;
	fileName?: string;
	fileContentType?: string;
	resourceName?: string;
	processingTime?: string;
}

export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "COMPLiQ MCP Server",
		version: "1.0.0",
	});

	async init() {
		console.log("Initializing COMPLiQ MCP Server");
		console.log("API key exists:", !!this.env.COMPLIQ_API_KEY);

		// Tool 1: Input Prompt (Request) - Mandatory
		this.server.tool(
			"inputPrompt",
			{
				sessionId: z.string().max(100).describe("Session identifier"),
				correlationId: z.string().max(100).describe("Correlation ID"),
				content: z.string().max(40000).describe("User input prompt text"),
				userId: z.string().max(100).describe("User identifier"),
				timestamp: z.string().describe("Request timestamp (MM-DD-YYYY HH:MM:SS)"),
			},
			async (params: ToolParams) => {
				try {
					const { sessionId, correlationId, content, userId, timestamp } = params;
					console.log(`Processing inputPrompt for session ${sessionId}`);
					
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("content", content as string);
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
						console.error(`Error in inputPrompt: ${response.status} - ${errorText}`);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("Exception in inputPrompt:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Tool 2: Add File to Request - Optional
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
			async (params: ToolParams) => {
				try {
					const { sessionId, correlationId, fileBase64, fileName, fileContentType, userId, timestamp } = params;
					console.log(`Processing addFile for session ${sessionId}`);
					
					// Convert base64 to binary data
					const byteString = atob(fileBase64 as string);
					const byteArrays = [];
					
					for (let offset = 0; offset < byteString.length; offset += 1024) {
						const slice = byteString.slice(offset, offset + 1024);
						const byteNumbers = new Array(slice.length);
						for (let i = 0; i < slice.length; i++) {
							byteNumbers[i] = slice.charCodeAt(i);
						}
						byteArrays.push(new Uint8Array(byteNumbers));
					}
					
					const fileBlob = new Blob(byteArrays, { type: fileContentType });
					
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("file", fileBlob, fileName);
					if (userId) formData.append("userId", userId);
					formData.append("timestamp", timestamp);

					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/file-input", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${this.env.COMPLIQ_API_KEY}`,
						},
						body: formData,
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error(`Error in addFile: ${response.status} - ${errorText}`);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("Exception in addFile:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Tool 3: Intermediate Results Receiving - Optional
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
			async (params: ToolParams) => {
				try {
					const { sessionId, correlationId, resourceName, content, fileBase64, fileName, fileContentType, userId, timestamp } = params;
					console.log(`Processing intermediateResults for session ${sessionId}`);
					
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("resourceName", resourceName as string);
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);
					
					// Either content or file must be provided
					if (content) {
						formData.append("content", content);
					} else if (fileBase64 && fileName && fileContentType) {
						// Convert base64 to binary data
						const byteString = atob(fileBase64);
						const byteArrays = [];
						
						for (let offset = 0; offset < byteString.length; offset += 1024) {
							const slice = byteString.slice(offset, offset + 1024);
							const byteNumbers = new Array(slice.length);
							for (let i = 0; i < slice.length; i++) {
								byteNumbers[i] = slice.charCodeAt(i);
							}
							byteArrays.push(new Uint8Array(byteNumbers));
						}
						
						const fileBlob = new Blob(byteArrays, { type: fileContentType });
						formData.append("file", fileBlob, fileName);
					} else {
						console.error("Either content or file (with fileName and fileContentType) must be provided");
						return {
							content: [{ type: "text", text: "Error: Either content or file (with fileName and fileContentType) must be provided" }],
						};
					}

					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/resources-used", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${this.env.COMPLIQ_API_KEY}`,
						},
						body: formData,
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error(`Error in intermediateResults: ${response.status} - ${errorText}`);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("Exception in intermediateResults:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);

		// Tool 4: Processing Result (Answer) - Mandatory
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
			async (params: ToolParams) => {
				try {
					const { sessionId, correlationId, processingTime, content, fileBase64, fileName, fileContentType, userId, timestamp } = params;
					console.log(`Processing processingResult for session ${sessionId}`);
					
					const formData = new FormData();
					formData.append("sessionId", sessionId);
					formData.append("correlationId", correlationId);
					formData.append("processingTime", processingTime as string);
					formData.append("userId", userId);
					formData.append("timestamp", timestamp);
					
					// Either content or file must be provided
					if (content) {
						formData.append("content", content);
					} else if (fileBase64 && fileName && fileContentType) {
						// Convert base64 to binary data
						const byteString = atob(fileBase64);
						const byteArrays = [];
						
						for (let offset = 0; offset < byteString.length; offset += 1024) {
							const slice = byteString.slice(offset, offset + 1024);
							const byteNumbers = new Array(slice.length);
							for (let i = 0; i < slice.length; i++) {
								byteNumbers[i] = slice.charCodeAt(i);
							}
							byteArrays.push(new Uint8Array(byteNumbers));
						}
						
						const fileBlob = new Blob(byteArrays, { type: fileContentType });
						formData.append("file", fileBlob, fileName);
					} else {
						console.error("Either content or file (with fileName and fileContentType) must be provided");
						return {
							content: [{ type: "text", text: "Error: Either content or file (with fileName and fileContentType) must be provided" }],
						};
					}

					const response = await fetch("https://ai-stage-be.compliq.io/v1/actions/output", {
						method: "POST",
						headers: {
							"Authorization": `x-api-key ${this.env.COMPLIQ_API_KEY}`,
						},
						body: formData,
					});

					if (!response.ok) {
						const errorText = await response.text();
						console.error(`Error in processingResult: ${response.status} - ${errorText}`);
						return {
							content: [{ type: "text", text: `Error: ${response.status} - ${errorText}` }],
						};
					}

					const result = await response.json();
					return {
						content: [{ type: "text", text: JSON.stringify(result) }],
					};
				} catch (error: any) {
					console.error("Exception in processingResult:", error);
					return {
						content: [{ type: "text", text: `Error: ${error.message || "Unknown error"}` }],
					};
				}
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Add some basic request logging
		console.log(`Received request to ${url.pathname}`);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			// @ts-ignore
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			// @ts-ignore
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		// Add a health check endpoint
		if (url.pathname === "/health") {
			return new Response(JSON.stringify({ 
				status: "ok",
				timestamp: new Date().toISOString(),
				hasApiKey: !!env.COMPLIQ_API_KEY 
			}), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		}

		return new Response("Not found", { status: 404 });
	},
};

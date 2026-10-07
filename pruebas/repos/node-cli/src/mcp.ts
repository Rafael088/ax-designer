import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "tareas", version: "1.2.3" });
server.tool("estado", "El estado resumido", async () => ({ content: [] }));
server.registerTool("entregar", {}, async () => ({ content: [] }));

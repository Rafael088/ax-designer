// Plantilla de ax/mcp/servidor.mjs: el MCP server por stdio. Solo cablea el SDK con
// herramientas.mjs: tools/list devuelve las tools del contrato y tools/call las corre por el CLI.
// Usa el `Server` de bajo nivel del SDK para dar el inputSchema como JSON Schema tal cual, sin zod.
//
// Igual que la otra plantilla: sin comillas invertidas, `${` ni barras invertidas en el código fijo.

export function plantillaDeServidor(): string {
  return `#!/usr/bin/env node
// El MCP server de este repo, por stdio. Envuelve al CLI de AX: cada tool llama a un verbo del
// contrato (ax/contrato.json) y devuelve su JSON. Para cambiar las tools, cambia el contrato y
// vuelve a generar; no las edites aquí.
import { realpathSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { INSTRUCCIONES, NOMBRE, VERSION, listar, llamar } from "./herramientas.mjs";

function resultado(llamada) {
  const json = llamada.json;
  const respuesta = { content: [{ type: "text", text: JSON.stringify(json) }], isError: llamada.esError };
  // structuredContent tiene que ser un objeto: una lista se queda solo en el texto.
  if (json !== null && typeof json === "object" && !Array.isArray(json)) respuesta.structuredContent = json;
  return respuesta;
}

export function crearServidor() {
  const servidor = new Server({ name: NOMBRE, version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCCIONES });
  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listar() }));
  servidor.setRequestHandler(CallToolRequestSchema, async (peticion) => {
    try {
      return resultado(await llamar(peticion.params.name, peticion.params.arguments));
    } catch (e) {
      return resultado({
        esError: true,
        json: { esquema: 1, error: "Falló el servidor MCP: " + (e && e.message ? e.message : String(e)), salida: "Es un fallo del envoltorio generado: avisa a una persona con este mensaje.", reintentable: false },
      });
    }
  });
  return servidor;
}

function esPrincipal() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (esPrincipal()) {
  await crearServidor().connect(new StdioServerTransport());
}
`;
}

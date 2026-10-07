// El MCP server generado, cargado y probado en un directorio temporal contra un CLI de mentira:
// sin red, sin agentes y sin el SDK de verdad (va uno de mentira en node_modules/ del temporal).
// La prueba con el SDK real solo corre si AXD_SDK_MCP apunta a una carpeta node_modules que lo
// tenga: `AXD_SDK_MCP=/ruta/node_modules npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { generarContrato } from "../../src/contrato/index.ts";
import { aplicar, archivosMcp, leerCabecera } from "../../src/generadores/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import { ErrorAx, type Contrato } from "../../src/modelo/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";

const NODE_CLI = join(import.meta.dirname, "..", "repos", "node-cli");

function contratoDe(ruta: string): Contrato {
  const inventario = analizar(lectorDeDisco(ruta));
  return generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
}

const contrato = contratoDe(NODE_CLI);

// El CLI de mentira: responde lo que recibió, y simula el 4 de una huella vieja y una salida sin JSON.
const CLI_DE_MENTIRA = `
const [verbo, ...resto] = process.argv.slice(2);
const responder = (codigo, cuerpo) => { process.stdout.write(JSON.stringify(cuerpo)); process.exitCode = codigo; };
if (verbo === "estado") responder(0, { esquema: 1, tareas: 1, huella: "h-1", argv: resto });
else if (verbo === "listar" && resto.includes("--estado=sin-json")) { process.stdout.write("hola"); process.stderr.write("se rompió"); process.exitCode = 1; }
else if (verbo === "listar") responder(0, [{ id: "t-1" }, { argv: resto }]);
else if (verbo === "entregar" && resto.includes("--huella=vieja")) responder(4, { esquema: 1, error: "El estado cambió.", salida: "Vuelve a leer con estado.", reintentable: true });
else if (verbo === "entregar") responder(0, { esquema: 1, ensayo: !resto.includes("--aplicar"), argv: resto });
else responder(2, { esquema: 1, error: "verbo desconocido", salida: "mira --help", reintentable: false });
`;

type Llamada = { esError: boolean; codigo: number | null; json: Record<string, unknown> };
type Herramientas = {
  CONTRATO: string;
  RAIZ: string;
  listar(): { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }; annotations: { readOnlyHint: boolean } }[];
  argvDe(h: unknown, args: unknown): { argv?: string[]; error?: Record<string, unknown> };
  llamar(nombre: string, args?: unknown): Promise<Llamada>;
  HERRAMIENTAS: unknown[];
};

function generarEn(raiz: string) {
  return aplicar(raiz, contrato.huella, archivosMcp(contrato));
}

const raiz = mkdtempSync(join(tmpdir(), "axd-mcp-"));
const hecho = generarEn(raiz);
writeFileSync(join(raiz, "ax/cli.mjs"), CLI_DE_MENTIRA);
const herramientas = (await import(pathToFileURL(join(raiz, "ax/mcp/herramientas.mjs")).href)) as Herramientas;

test("genera el contrato, las tools, el servidor, su package.json y su README, todos con cabecera", () => {
  assert.deepEqual(hecho.escritos.map((e) => e.ruta), ["ax/contrato.json", "ax/mcp/herramientas.mjs", "ax/mcp/servidor.mjs", "ax/mcp/package.json", "ax/mcp/README.md"]);
  for (const e of hecho.escritos) assert.deepEqual(leerCabecera(readFileSync(join(raiz, e.ruta), "utf8")), { contrato: contrato.huella, intacto: true });
  const guardado = JSON.parse(readFileSync(join(raiz, "ax/contrato.json"), "utf8"));
  assert.equal(guardado.huella, contrato.huella);
  assert.equal("raiz" in guardado, false);
});

test("el SDK de MCP es dependencia del paquete generado, no de axd", () => {
  const paquete = JSON.parse(readFileSync(join(raiz, "ax/mcp/package.json"), "utf8"));
  assert.deepEqual(Object.keys(paquete.dependencies), ["@modelcontextprotocol/sdk"]);
  assert.equal(paquete.type, "module");
  const axd = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"));
  assert.equal(axd.dependencies, undefined);
  assert.equal(readFileSync(join(raiz, "ax/mcp/herramientas.mjs"), "utf8").includes("@modelcontextprotocol"), false, "herramientas.mjs no importa el SDK");
});

test("una tool por verbo del contrato, con el inputSchema de sus entradas; las vedadas no son tools", () => {
  const tools = herramientas.listar();
  assert.deepEqual(tools.map((t) => t.name), contrato.verbos.map((v) => v.nombre));
  for (const vedada of contrato.vedadas) assert.ok(!tools.some((t) => t.name === vedada.nombre));
  const entregar = tools.find((t) => t.name === "entregar")!;
  assert.deepEqual(Object.keys(entregar.inputSchema.properties), ["id", "evidencia", "aplicar", "huella"]);
  assert.deepEqual(entregar.inputSchema.required, ["id", "evidencia"]);
  assert.equal(entregar.inputSchema.additionalProperties, false);
  assert.deepEqual(entregar.inputSchema.properties["aplicar"], { type: "boolean", description: contrato.verbos[2]!.entradas[2]!.descripcion });
  assert.equal(entregar.annotations.readOnlyHint, false);
  assert.equal(tools[0]!.annotations.readOnlyHint, true);
  assert.match(entregar.description, /ensayo/);
  assert.equal(herramientas.CONTRATO, contrato.huella);
  assert.equal(herramientas.RAIZ, raiz);
});

test("traduce argumentos a argv según la convención del contrato", () => {
  const [, , entregar] = herramientas.HERRAMIENTAS;
  assert.deepEqual(herramientas.argvDe(entregar, { evidencia: "npm test: 9/9", id: "t-1", aplicar: true, huella: "h-1" }).argv, [
    "ax/cli.mjs", "entregar", "t-1", "--evidencia=npm test: 9/9", "--aplicar", "--huella=h-1",
  ]);
  assert.deepEqual(herramientas.argvDe(entregar, { evidencia: "x", id: "t-1", aplicar: false }).argv, ["ax/cli.mjs", "entregar", "t-1", "--evidencia=x"]);
});

test("una lectura llama al CLI y devuelve su JSON tal cual", async () => {
  assert.deepEqual(await herramientas.llamar("estado", {}), { esError: false, codigo: 0, json: { esquema: 1, tareas: 1, huella: "h-1", argv: [] } });
  const lista = await herramientas.llamar("listar", { estado: "pendiente" });
  assert.deepEqual(lista.json, [{ id: "t-1" }, { argv: ["--estado=pendiente"] }]);
});

test("una escritura sin aplicar llega al CLI como ensayo, y con aplicar como escritura", async () => {
  const ensayo = await herramientas.llamar("entregar", { id: "t-1", evidencia: "ok" });
  assert.deepEqual(ensayo.json, { esquema: 1, ensayo: true, argv: ["t-1", "--evidencia=ok"] });
  const escritura = await herramientas.llamar("entregar", { id: "t-1", evidencia: "ok", aplicar: true });
  assert.equal(escritura.json["ensayo"], false);
});

test("un error del CLI conserva error, salida y reintentable, y dice con qué código salió", async () => {
  const r = await herramientas.llamar("entregar", { id: "t-1", evidencia: "ok", aplicar: true, huella: "vieja" });
  assert.deepEqual(r, {
    esError: true, codigo: 4,
    json: { esquema: 1, error: "El estado cambió.", salida: "Vuelve a leer con estado.", reintentable: true, codigo_de_salida: 4 },
  });
});

test("entradas inválidas son un error de uso que no lanza el CLI", async () => {
  for (const args of [{ id: "t-1" }, { id: "t-1", evidencia: 3 }, { id: "t-1", evidencia: "x", sobra: 1 }, { id: "--aplicar", evidencia: "x" }, "no-es-objeto"]) {
    const r = await herramientas.llamar("entregar", args);
    assert.equal(r.esError, true);
    assert.equal(r.codigo, 2);
    assert.equal(r.json["reintentable"], false);
    assert.match(r.json["salida"] as string, /inputSchema de «entregar»/);
  }
});

test("una transición vedada o una tool que no existe contestan con error y salida", async () => {
  const vedada = await herramientas.llamar("pendiente-a-hecha", {});
  assert.equal(vedada.esError, true);
  assert.match(vedada.json["error"] as string, /vedada/);
  assert.match(vedada.json["salida"] as string, /persona/);
  const otra = await herramientas.llamar("borrar-todo", {});
  assert.equal(otra.esError, true);
  assert.match(otra.json["error"] as string, /borrar-todo/);
});

test("si el CLI no devuelve JSON, el error lo dice con su salida de errores", async () => {
  const r = await herramientas.llamar("listar", { estado: "sin-json" });
  assert.equal(r.esError, true);
  assert.equal(r.codigo, 1);
  assert.match(r.json["error"] as string, /no devolvió JSON/);
  assert.match(r.json["salida"] as string, /se rompió/);
});

test("si el CLI del contrato no existe todavía, dice cómo generarlo", async () => {
  const otra = mkdtempSync(join(tmpdir(), "axd-mcp-sin-cli-"));
  generarEn(otra);
  const sinCli = (await import(pathToFileURL(join(otra, "ax/mcp/herramientas.mjs")).href)) as Herramientas;
  const r = await sinCli.llamar("estado", {});
  assert.equal(r.esError, true);
  assert.match(r.json["error"] as string, /ax\/cli\.mjs/);
  assert.match(r.json["salida"] as string, /axd generar cli/);
});

// Un SDK de mentira con la misma forma que el de verdad: Server con setRequestHandler y connect.
function sdkDeMentira(carpeta: string): void {
  const sdk = join(carpeta, "node_modules", "@modelcontextprotocol", "sdk");
  mkdirSync(join(sdk, "server"), { recursive: true });
  writeFileSync(join(sdk, "package.json"), JSON.stringify({
    name: "@modelcontextprotocol/sdk", type: "module",
    exports: { "./server/index.js": "./server/index.js", "./server/stdio.js": "./server/stdio.js", "./types.js": "./types.js" },
  }));
  writeFileSync(join(sdk, "types.js"), 'export const ListToolsRequestSchema = { metodo: "tools/list" };\nexport const CallToolRequestSchema = { metodo: "tools/call" };\n');
  writeFileSync(join(sdk, "server", "stdio.js"), "export class StdioServerTransport {}\n");
  writeFileSync(join(sdk, "server", "index.js"), [
    "export class Server {",
    "  constructor(info, opciones) { this.info = info; this.opciones = opciones; this.manejadores = new Map(); this.conectado = false; }",
    "  setRequestHandler(esquema, manejador) { this.manejadores.set(esquema.metodo, manejador); }",
    "  async connect() { this.conectado = true; }",
    "}",
    "",
  ].join("\n"));
}

test("servidor.mjs cablea tools/list y tools/call del SDK con las tools, sin conectarse al importarlo", async () => {
  sdkDeMentira(join(raiz, "ax", "mcp"));
  const modulo = (await import(pathToFileURL(join(raiz, "ax/mcp/servidor.mjs")).href)) as { crearServidor(): any };
  const servidor = modulo.crearServidor();
  assert.equal(servidor.conectado, false);
  assert.deepEqual(servidor.info, { name: "tareas-ax-mcp", version: `0.0.0+${contrato.huella.slice(0, 12)}` });
  assert.deepEqual(servidor.opciones.capabilities, { tools: {} });
  assert.match(servidor.opciones.instructions, /Empieza por «estado»/);
  const lista = await servidor.manejadores.get("tools/list")({ method: "tools/list" });
  assert.deepEqual(lista.tools.map((t: { name: string }) => t.name), ["estado", "listar", "entregar"]);
  const bien = await servidor.manejadores.get("tools/call")({ method: "tools/call", params: { name: "estado", arguments: {} } });
  assert.equal(bien.isError, false);
  assert.deepEqual(JSON.parse(bien.content[0].text), bien.structuredContent);
  const lista2 = await servidor.manejadores.get("tools/call")({ method: "tools/call", params: { name: "listar" } });
  assert.equal(lista2.structuredContent, undefined, "una lista no va en structuredContent");
  const mal = await servidor.manejadores.get("tools/call")({ method: "tools/call", params: { name: "entregar", arguments: { id: "t-1", evidencia: "x", aplicar: true, huella: "vieja" } } });
  assert.equal(mal.isError, true);
  assert.equal(mal.structuredContent.reintentable, true);
  rmSync(join(raiz, "ax", "mcp", "node_modules"), { recursive: true, force: true });
});

const SDK_REAL = process.env["AXD_SDK_MCP"];

test("con el SDK de verdad: initialize, tools/list y tools/call por stdio", { skip: SDK_REAL === undefined || !existsSync(join(SDK_REAL, "@modelcontextprotocol", "sdk")) ? "sin AXD_SDK_MCP" : false }, async () => {
  const otra = mkdtempSync(join(tmpdir(), "axd-mcp-sdk-"));
  generarEn(otra);
  writeFileSync(join(otra, "ax/cli.mjs"), CLI_DE_MENTIRA);
  symlinkSync(SDK_REAL!, join(otra, "ax", "mcp", "node_modules"));
  const hijo = spawn(process.execPath, [join(otra, "ax/mcp/servidor.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
  const respuestas = new Map<number, any>();
  let resto = "";
  hijo.stdout.on("data", (b: Buffer) => {
    resto += b.toString("utf8");
    let i;
    while ((i = resto.indexOf("\n")) !== -1) {
      const linea = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linea.trim() !== "") {
        const m = JSON.parse(linea);
        respuestas.set(m.id, m);
      }
    }
  });
  const enviar = (m: object) => hijo.stdin.write(JSON.stringify(m) + "\n");
  const esperar = async (id: number) => {
    for (let i = 0; i < 100 && !respuestas.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    return respuestas.get(id);
  };
  enviar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "0" } } });
  assert.equal((await esperar(1)).result.serverInfo.name, "tareas-ax-mcp");
  enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
  enviar({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual((await esperar(2)).result.tools.map((t: { name: string }) => t.name), ["estado", "listar", "entregar"]);
  enviar({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "entregar", arguments: { id: "t-1", evidencia: "ok", aplicar: true, huella: "vieja" } } });
  const r = (await esperar(3)).result;
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.salida, "Vuelve a leer con estado.");
  hijo.kill();
});

test("archivosMcp se niega con 5 si el contrato no tiene verbos", () => {
  assert.throws(() => archivosMcp({ ...contrato, verbos: [] }), (e: unknown) => e instanceof ErrorAx && e.codigo === 5);
});

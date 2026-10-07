// De punta a punta: `axd generar cli` y `axd generar mcp` sobre la misma copia temporal de un repo
// de mentira, y las tools del MCP (herramientas.mjs, sin SDK) llamando al CLI generado de verdad.
// Sin red ni agentes, nunca contra este repo. Con AXD_SDK_MCP apuntando a un node_modules con
// @modelcontextprotocol/sdk, también por stdio con el SDK real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAIZ = join(import.meta.dirname, "..", "..");
const AXD = join(RAIZ, "src", "cli", "main.ts");
const REPOS = join(RAIZ, "pruebas", "repos");

type Llamada = { esError: boolean; codigo: number | null; json: Record<string, any> };
type Herramientas = { listar(): { name: string }[]; llamar(nombre: string, args?: unknown): Promise<Llamada> };

function axd(...argumentos: string[]) {
  const r = spawnSync(process.execPath, [AXD, ...argumentos], { encoding: "utf8" });
  return { codigo: r.status, json: JSON.parse(r.stdout) as Record<string, any> };
}

function copia(repo: string): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-e2e-")), repo);
  cpSync(join(REPOS, repo), destino, { recursive: true });
  return destino;
}

/** Ensaya y aplica con la huella del ensayo, como lo haría un agente. */
function generar(generador: "cli" | "mcp", repo: string) {
  const ensayo = axd("generar", generador, repo);
  assert.equal(ensayo.codigo, 0, JSON.stringify(ensayo.json));
  const hecho = axd("generar", generador, repo, "--aplicar", "--huella", ensayo.json["huella_del_destino"]);
  assert.equal(hecho.codigo, 0, JSON.stringify(hecho.json));
  return hecho.json;
}

async function herramientasDe(repo: string): Promise<Herramientas> {
  return (await import(pathToFileURL(join(repo, "ax/mcp/herramientas.mjs")).href)) as Herramientas;
}

test("node-cli: generar cli y mcp sobre la misma copia, y las tools llaman al CLI generado de verdad", async () => {
  const repo = copia("node-cli");
  const contratoAntes = axd("contrato", repo).json["huella"];
  const cli = generar("cli", repo);
  assert.deepEqual(cli["escritos"].map((e: { ruta: string }) => e.ruta), ["ax/contrato.json", "ax/cli.mjs", "ax/cli.md"]);
  const mcp = generar("mcp", repo);
  assert.deepEqual(mcp["sin_cambios"], ["ax/contrato.json"], "los dos generadores escriben el mismo contrato");
  assert.equal(axd("contrato", repo).json["huella"], contratoAntes, "lo generado no cambia el contrato");
  assert.equal(axd("generar", "cli", repo, "--aplicar").json["escritos"].length, 0, "regenerar el CLI no cambia nada");

  const h = await herramientasDe(repo);
  assert.deepEqual(h.listar().map((t) => t.name), ["estado", "listar", "entregar"]);

  const estado = await h.llamar("estado", {});
  assert.equal(estado.esError, false);
  assert.equal(estado.codigo, 0);
  assert.match(estado.json["huella"], /^[0-9a-f]{64}$/);
  assert.equal(estado.json["fuentes"][1]["ruta"], "data/estado.json");

  const lista = await h.llamar("listar", { estado: "pendiente" });
  assert.deepEqual([lista.esError, lista.json["filtros"], lista.json["total"]], [false, { estado: "pendiente" }, 0]);

  const bitacora = join(repo, "data/bitacora.jsonl");
  const antes = readFileSync(bitacora, "utf8");
  const ensayo = await h.llamar("entregar", { id: "t-1", evidencia: "npm test: 9/9", huella: estado.json["huella"] });
  assert.equal(ensayo.esError, false);
  assert.equal(ensayo.json["ensayo"], true);
  assert.equal(readFileSync(bitacora, "utf8"), antes, "sin aplicar no escribe");

  const hecho = await h.llamar("entregar", { id: "t-1", evidencia: "npm test: 9/9", aplicar: true, huella: estado.json["huella"] });
  assert.equal(hecho.esError, false);
  assert.equal(hecho.json["ensayo"], false);
  assert.notEqual(hecho.json["huella"], estado.json["huella"]);
  assert.equal(readFileSync(bitacora, "utf8").trim().split("\n").length, 3);
  assert.equal((await h.llamar("estado", {})).json["huella"], hecho.json["huella"]);

  const vieja = await h.llamar("entregar", { id: "t-1", evidencia: "otra", aplicar: true, huella: estado.json["huella"] });
  assert.deepEqual([vieja.esError, vieja.codigo, vieja.json["codigo_de_salida"], vieja.json["reintentable"]], [true, 4, 4, true]);
  assert.match(vieja.json["salida"], /Vuelve a leer/);

  const noExiste = await h.llamar("entregar", { id: "t-9", evidencia: "x" });
  assert.deepEqual([noExiste.esError, noExiste.codigo], [true, 2]);
  assert.match(noExiste.json["error"], /t-9/);

  const vedada = await h.llamar("pendiente-a-hecha", {});
  assert.equal(vedada.esError, true);
  assert.match(vedada.json["salida"], /persona/);
  assert.equal(readFileSync(bitacora, "utf8").trim().split("\n").length, 3, "nada de lo que falló escribió");
});

test("python-cli: el MCP llama al CLI generado en Python; lo que no se pudo implementar llega como 5 accionable", { skip: spawnSync("python3", ["--version"]).status === 0 ? false : "python3 no está en esta máquina" }, async () => {
  const repo = copia("python-cli");
  generar("cli", repo);
  generar("mcp", repo);
  assert.ok(existsSync(join(repo, "ax/cli.py")));
  const h = await herramientasDe(repo);
  const lista = await h.llamar("listar-tareas", {});
  assert.equal(lista.esError, false);
  assert.deepEqual(lista.json["registros"].map((r: { id: string }) => r.id), ["t-1", "t-2"]);
  const entregar = await h.llamar("entregar", { evidencia: "x", aplicar: true });
  assert.deepEqual([entregar.esError, entregar.codigo, entregar.json["reintentable"]], [true, 5, false]);
  assert.match(entregar.json["salida"], /bitácora JSONL/);
});

const SDK_REAL = process.env["AXD_SDK_MCP"];

test("con el SDK de verdad: tools/call por stdio llega al CLI generado y devuelve su JSON", { skip: SDK_REAL === undefined || !existsSync(join(SDK_REAL, "@modelcontextprotocol", "sdk")) ? "sin AXD_SDK_MCP" : false }, async () => {
  const repo = copia("node-cli");
  generar("cli", repo);
  generar("mcp", repo);
  symlinkSync(SDK_REAL!, join(repo, "ax", "mcp", "node_modules"));
  const hijo = spawn(process.execPath, [join(repo, "ax/mcp/servidor.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
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
    for (let i = 0; i < 200 && !respuestas.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    return respuestas.get(id);
  };
  try {
    enviar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prueba", version: "0" } } });
    assert.equal((await esperar(1)).result.serverInfo.name, "tareas-ax-mcp");
    enviar({ jsonrpc: "2.0", method: "notifications/initialized" });
    enviar({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "estado", arguments: {} } });
    const estado = (await esperar(2)).result;
    assert.equal(estado.isError, false);
    assert.match(estado.structuredContent.huella, /^[0-9a-f]{64}$/);
    enviar({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "entregar", arguments: { id: "t-1", evidencia: "ok", aplicar: true, huella: "0".repeat(64) } } });
    const vieja = (await esperar(3)).result;
    assert.equal(vieja.isError, true);
    assert.equal(vieja.structuredContent.codigo_de_salida, 4);
  } finally {
    hijo.kill();
  }
});

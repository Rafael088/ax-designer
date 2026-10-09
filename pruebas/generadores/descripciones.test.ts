// De punta a punta con next-panel: `axd generar cli|mcp --aplicar` en una copia, y lo que lee el
// agente sin abrir el código —ax/cli.md, `--help`, `<verbo> --help` y las tools del MCP— lleva las
// descripciones sacadas del manejador: qué devuelve, de qué periodo, defecto y topes de cada entrada.
// No hace falta servidor: ninguna de estas llamadas hace una petición.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { generarContrato } from "../../src/contrato/index.ts";
import { aplicar, archivosCli } from "../../src/generadores/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import type { Contrato } from "../../src/modelo/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const AXD = join(RAIZ, "src", "cli", "main.ts");
const HAY_PYTHON = spawnSync("python3", ["--version"]).status === 0;

function axd(...argumentos: string[]) {
  const r = spawnSync(process.execPath, [AXD, ...argumentos], { encoding: "utf8" });
  return { codigo: r.status, json: JSON.parse(r.stdout) as Record<string, any> };
}

const raiz = join(mkdtempSync(join(tmpdir(), "axd-descripciones-")), "next-panel");
cpSync(join(RAIZ, "pruebas", "repos", "next-panel"), raiz, { recursive: true });
assert.equal(axd("generar", "cli", raiz, "--aplicar").codigo, 0);
assert.equal(axd("generar", "mcp", raiz, "--aplicar").codigo, 0);

function cli(argv: string[]) {
  const r = spawnSync(process.execPath, [join(raiz, "ax", "cli.mjs"), ...argv], { cwd: raiz, encoding: "utf8" });
  return { codigo: r.status, json: JSON.parse(r.stdout) as Record<string, any> };
}

test("ax/cli.md: el detalle de cada verbo con su descripción y la de cada entrada", () => {
  const leeme = readFileSync(join(raiz, "ax", "cli.md"), "utf8");
  assert.match(leeme, /## Detalle de los verbos/);
  assert.match(leeme, /### `listar-pedidos`\n\nLos últimos pedidos, del más reciente al más viejo\. Lee GET \/api\/pedidos: devuelve una lista de Pedido/);
  assert.match(leeme, /- `--limite`: Parámetro de consulta «limite»: número; fija cuántos devuelve; por defecto 30; de 1 a 200/);
  assert.match(leeme, /- `--q` \(requerida\): Parámetro de consulta «q»: texto; requerido/);
  assert.match(leeme, /masVendidos \(de los últimos 30 días; PedidoItem agrupado por productoId/);
  assert.match(leeme, /`node ax\/cli\.mjs <verbo> --help`/);
  assert.doesNotMatch(leeme, /Llama a /);
});

test("node: --help da la descripción con significado y cómo pedir el detalle; <verbo> --help da cada entrada", () => {
  const ayuda = cli(["--help"]);
  assert.equal(ayuda.codigo, 0);
  const pedidos = ayuda.json["verbos"].find((v: { nombre: string }) => v.nombre === "listar-pedidos");
  assert.match(pedidos.descripcion, /como mucho «limite» \(por defecto 30, máximo 200\)/);
  assert.match(ayuda.json["detalle"], /<verbo> --help/);
  const verbo = cli(["listar-gastos", "--help"]);
  assert.equal(verbo.codigo, 0, JSON.stringify(verbo.json));
  assert.equal(verbo.json["verbo"], "listar-gastos");
  assert.equal(verbo.json["uso"], "node ax/cli.mjs listar-gastos --categoria=… --dias=…");
  assert.deepEqual(verbo.json["entradas"].map((e: { entrada: string }) => e.entrada), ["--categoria", "--dias"]);
  assert.match(verbo.json["entradas"][1].descripcion, /por defecto 30; de 1 a 365/);
  assert.equal(cli(["listar-buscar", "--q=ab", "-h"]).json["verbo"], "listar-buscar", "-h también, aunque haya otras entradas");
});

test("python: el mismo <verbo> --help", { skip: HAY_PYTHON ? false : "python3 no está en esta máquina" }, () => {
  const raizPy = join(mkdtempSync(join(tmpdir(), "axd-descripciones-py-")), "next-panel");
  cpSync(join(RAIZ, "pruebas", "repos", "next-panel"), raizPy, { recursive: true });
  const inventario = analizar(lectorDeDisco(raizPy));
  const base = generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
  const contrato: Contrato = { ...base, cli: { ...base.cli, lenguaje: "python", ruta: "ax/cli.py", programa: "python3", argumentos: ["ax/cli.py"] } };
  aplicar(raizPy, contrato.huella, archivosCli(contrato));
  const r = spawnSync("python3", ["ax/cli.py", "listar-pedidos", "--help"], { cwd: raizPy, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout) as Record<string, any>;
  assert.equal(json["verbo"], "listar-pedidos");
  assert.equal(json["uso"], "python3 ax/cli.py listar-pedidos --limite=…");
  assert.match(json["entradas"][0].descripcion, /por defecto 30; de 1 a 200/);
  const ayuda = JSON.parse(spawnSync("python3", ["ax/cli.py", "--help"], { cwd: raizPy, encoding: "utf8" }).stdout) as Record<string, any>;
  assert.match(ayuda["detalle"], /<verbo> --help/);
});

test("mcp: cada tool lleva la descripción del verbo y cada propiedad de su inputSchema la de su entrada", async () => {
  const h = (await import(pathToFileURL(join(raiz, "ax/mcp/herramientas.mjs")).href)) as {
    listar(): { name: string; description: string; inputSchema: { properties: Record<string, { description: string }>; required: string[] } }[];
  };
  const tools = h.listar();
  const resumen = tools.find((t) => t.name === "resumen")!;
  assert.match(resumen.description, /^Lo que muestra la portada del panel, en una sola lectura\. Lee GET \/api\/resumen: devuelve un objeto con ventas \{hoy \(de hoy\)/);
  const pedidos = tools.find((t) => t.name === "listar-pedidos")!;
  assert.match(pedidos.inputSchema.properties["limite"]!.description, /por defecto 30; de 1 a 200/);
  const buscar = tools.find((t) => t.name === "listar-buscar")!;
  assert.deepEqual(buscar.inputSchema.required, ["q"]);
  assert.ok(tools.every((t) => !/^Llama a /.test(t.description)));
});

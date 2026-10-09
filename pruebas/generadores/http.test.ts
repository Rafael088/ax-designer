// De punta a punta con un repo Next (App Router + Prisma): `axd analizar` → `axd contrato` →
// `axd generar cli|mcp` (ensayo y --aplicar, en una copia temporal), y el CLI generado llamando de
// verdad a un servidor HTTP falso levantado aquí: se comprueba qué método, ruta, consulta y cuerpo
// le llegan, y cómo se traduce cada respuesta a los códigos del contrato. Sin red ni agentes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
const REPOS = join(RAIZ, "pruebas", "repos");
const HAY_PYTHON = spawnSync("python3", ["--version"]).status === 0;

function axd(...argumentos: string[]) {
  const r = spawnSync(process.execPath, [AXD, ...argumentos], { encoding: "utf8" });
  return { codigo: r.status, json: JSON.parse(r.stdout) as Record<string, any> };
}

function copia(repo: string): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-http-")), repo);
  cpSync(join(REPOS, repo), destino, { recursive: true });
  return destino;
}

// --- el servidor falso: anota cada petición y responde según la ruta ---

type Peticion = { metodo: string; url: string; tipo: string | undefined; cuerpo: unknown };
const recibidas: Peticion[] = [];

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((listo) => {
    const trozos: Buffer[] = [];
    req.on("data", (t: Buffer) => trozos.push(t));
    req.on("end", () => listo(Buffer.concat(trozos).toString("utf8")));
  });
}

function responder(metodo: string, url: URL, cuerpo: any): { estado: number; json?: unknown } {
  const ruta = url.pathname;
  if (metodo === "GET" && ruta === "/api/productos") {
    if (url.searchParams.get("categoria") === "grande") {
      return { estado: 200, json: { data: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, nombre: `Producto número ${i + 1}`, precio: i * 10 })), error: null } };
    }
    return { estado: 200, json: { data: [{ id: 7, nombre: "Camiseta" }], error: null } };
  }
  if (metodo === "GET" && ruta === "/api/productos/7") return { estado: 200, json: { data: { id: 7, nombre: "Camiseta" }, error: null } };
  if (metodo === "GET" && ruta === "/api/productos/500") return { estado: 500, json: { data: null, error: "Se cayó la base" } };
  if (metodo === "GET" && ruta.startsWith("/api/productos/")) return { estado: 404, json: { data: null, error: "Producto no encontrado" } };
  if (metodo === "POST" && ruta === "/api/productos") {
    return cuerpo?.nombre === "x" ? { estado: 422, json: { error: "nombre: muy corto" } } : { estado: 201, json: { data: { id: 8, ...cuerpo }, error: null } };
  }
  if (metodo === "PATCH" && ruta === "/api/productos/7") return { estado: 200, json: { data: { id: 7, ...cuerpo }, error: null } };
  if (metodo === "DELETE" && ruta === "/api/productos/7") return { estado: 204 };
  if (metodo === "GET" && ruta.startsWith("/api/docs/")) return { estado: 200, json: { data: ruta, error: null } };
  if (metodo === "POST" && ruta === "/api/contacto") return { estado: 401, json: { error: "Sin sesión" } };
  if (metodo === "POST" && ruta === "/api/ordenes") return { estado: 409, json: { error: "La orden ya existe" } };
  return { estado: 404, json: { error: "No existe" } };
}

const servidor: Server = createServer(async (req, res) => {
  const texto = await leerCuerpo(req);
  let cuerpo: unknown = texto === "" ? undefined : texto;
  try {
    cuerpo = texto === "" ? undefined : JSON.parse(texto);
  } catch {
    // se anota tal cual
  }
  const url = new URL(req.url ?? "/", "http://falso");
  recibidas.push({ metodo: req.method ?? "", url: req.url ?? "", tipo: req.headers["content-type"], cuerpo });
  const { estado, json } = responder(req.method ?? "", url, cuerpo);
  res.writeHead(estado, json === undefined ? {} : { "content-type": "application/json" });
  res.end(json === undefined ? undefined : JSON.stringify(json));
});
await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
const BASE = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
after(() => servidor.close());

/** Un puerto en el que no escucha nadie: para el servidor caído. */
async function puertoCerrado(): Promise<number> {
  const s = createServer();
  await new Promise<void>((listo) => s.listen(0, "127.0.0.1", listo));
  const puerto = (s.address() as AddressInfo).port;
  await new Promise((listo) => s.close(listo));
  return puerto;
}

type Corrida = { codigo: number | null; json: Record<string, any> };

/** Corre el CLI generado sin bloquear: el servidor falso vive en este mismo proceso. */
/** `base` null: sin AX_BASE_URL en el entorno. */
function correr(raiz: string, programa: string, argv: string[], base: string | null = BASE): Promise<Corrida> {
  return new Promise((listo, fallo) => {
    const env = { ...process.env };
    if (base === null) delete env["AX_BASE_URL"];
    else env["AX_BASE_URL"] = base;
    const hijo = spawn(programa, argv, { cwd: raiz, env });
    let salida = "";
    let errores = "";
    hijo.stdout.on("data", (t: Buffer) => (salida += t.toString("utf8")));
    hijo.stderr.on("data", (t: Buffer) => (errores += t.toString("utf8")));
    hijo.on("error", fallo);
    hijo.on("close", (codigo) => {
      try {
        assert.equal(errores, "", `stderr de ${argv.join(" ")}: ${errores}`);
        const lineas = salida.trim().split("\n");
        assert.equal(lineas.length, 1, `una sola línea de JSON: ${salida}`);
        listo({ codigo, json: JSON.parse(lineas[0]!) });
      } catch (e) {
        fallo(e);
      }
    });
  });
}

/** Lo que llegó al servidor durante `hacer`. */
async function peticionesDe(hacer: () => Promise<Corrida>): Promise<{ corrida: Corrida; peticiones: Peticion[] }> {
  const desde = recibidas.length;
  const corrida = await hacer();
  return { corrida, peticiones: recibidas.slice(desde) };
}

// --- analizar → contrato → generar, por el CLI de axd, en una copia temporal ---

const raiz = copia("next-prisma");

test("axd analizar ve las rutas y los modelos; axd contrato propone sus verbos", () => {
  const inventario = axd("analizar", raiz);
  assert.equal(inventario.codigo, 0);
  assert.equal(inventario.json["superficies"]["api"].length, 8);
  assert.equal(inventario.json["estado"][0]["formato"], "prisma");
  const contrato = axd("contrato", raiz);
  assert.equal(contrato.codigo, 0);
  assert.equal(contrato.json["verbos"].length, 8);
  assert.equal(contrato.json["http"]["base_url"]["variable"], "AX_BASE_URL");
});

test("axd generar cli y mcp: el ensayo lista los archivos sin escribir; --aplicar los escribe y regenerar no cambia nada", () => {
  for (const generador of ["cli", "mcp"]) {
    const ensayo = axd("generar", generador, raiz);
    assert.equal(ensayo.codigo, 0, JSON.stringify(ensayo.json));
    assert.ok(ensayo.json["archivos"].length >= 3);
    assert.ok(ensayo.json["archivos"].every((a: { ruta: string }) => a.ruta.startsWith("ax/")));
    const hecho = axd("generar", generador, raiz, "--aplicar", "--huella", ensayo.json["huella_del_destino"]);
    assert.equal(hecho.codigo, 0, JSON.stringify(hecho.json));
  }
  assert.ok(existsSync(join(raiz, "ax/cli.mjs")) && existsSync(join(raiz, "ax/mcp/herramientas.mjs")));
  assert.equal(axd("generar", "cli", raiz, "--aplicar").json["escritos"].length, 0);
  const estado = axd("estado", raiz);
  assert.equal(estado.json["generados"]["al_dia"], true);
});

const cli = (argv: string[], base: string | null = BASE) => correr(raiz, process.execPath, ["ax/cli.mjs", ...argv], base);

test("node: --help dice la URL base y los verbos HTTP", async () => {
  const ayuda = await cli(["--help"]);
  assert.equal(ayuda.codigo, 0);
  assert.deepEqual(ayuda.json["base_url"], { variable: "AX_BASE_URL", por_defecto: "http://localhost:3000" });
  assert.ok(ayuda.json["verbos"].every((v: { implementado: boolean }) => v.implementado));
});

test("node: una lectura llama a GET con el parámetro de la ruta y la consulta, y devuelve la respuesta", async () => {
  const leer = await peticionesDe(() => cli(["leer-productos", "7"]));
  assert.equal(leer.corrida.codigo, 0, JSON.stringify(leer.corrida.json));
  assert.deepEqual(leer.peticiones.map((p) => `${p.metodo} ${p.url}`), ["GET /api/productos/7"]);
  assert.deepEqual(leer.corrida.json["respuesta"], { data: { id: 7, nombre: "Camiseta" }, error: null });
  assert.equal(leer.corrida.json["estado"], 200);
  assert.deepEqual(leer.corrida.json["peticion"], { metodo: "GET", url: `${BASE}/api/productos/7` });

  const listar = await peticionesDe(() => cli(["listar-productos", "--categoria=3"]));
  assert.deepEqual(listar.peticiones.map((p) => `${p.metodo} ${p.url}`), ["GET /api/productos?categoria=3"]);
  assert.equal(listar.corrida.json["truncado"], false);

  const docs = await peticionesDe(() => cli(["leer-docs", "guia/primeros pasos"]));
  assert.deepEqual(docs.peticiones.map((p) => p.url), ["/api/docs/guia/primeros%20pasos"], "el resto de la ruta va segmento a segmento");
});

test("node: una lectura grande se recorta a su presupuesto y dice cuántas hay", async () => {
  const r = await cli(["listar-productos", "--categoria=grande"]);
  assert.equal(r.codigo, 0);
  assert.equal(r.json["truncado"], true);
  assert.equal(r.json["total"], 300);
  assert.ok(r.json["mostrados"] < 300 && r.json["mostrados"] > 0);
  assert.ok(Math.round(JSON.stringify(r.json).length / 4) <= r.json["presupuesto_tokens"]);
  assert.match(r.json["salida"], /Hay 300 y se muestran/);
});

test("node: una escritura es un ensayo que no llama a nada; con --aplicar hace la petición con el cuerpo JSON", async () => {
  const cuerpo = JSON.stringify({ nombre: "Gorra", precio: 20, etiquetas: [], categoriaId: 1 });
  const ensayo = await peticionesDe(() => cli(["crear-productos", `--cuerpo=${cuerpo}`]));
  assert.equal(ensayo.corrida.codigo, 0);
  assert.deepEqual(ensayo.peticiones, [], "el ensayo no toca el servidor");
  assert.equal(ensayo.corrida.json["ensayo"], true);
  assert.deepEqual(ensayo.corrida.json["peticion"], { metodo: "POST", url: `${BASE}/api/productos`, cuerpo: JSON.parse(cuerpo) });
  assert.deepEqual(ensayo.corrida.json["para_aplicar"], ["crear-productos", `--cuerpo=${cuerpo}`, "--aplicar"]);

  const hecho = await peticionesDe(() => cli(["crear-productos", `--cuerpo=${cuerpo}`, "--aplicar"]));
  assert.equal(hecho.corrida.codigo, 0, JSON.stringify(hecho.corrida.json));
  assert.deepEqual(hecho.peticiones, [{ metodo: "POST", url: "/api/productos", tipo: "application/json", cuerpo: JSON.parse(cuerpo) }]);
  assert.equal(hecho.corrida.json["ensayo"], false);
  assert.equal(hecho.corrida.json["estado"], 201);
  assert.equal(hecho.corrida.json["respuesta"]["data"]["id"], 8);

  const parche = await peticionesDe(() => cli(["actualizar-productos", "7", '--cuerpo={"precio":25}', "--aplicar"]));
  assert.deepEqual(parche.peticiones.map((p) => [p.metodo, p.url, p.cuerpo]), [["PATCH", "/api/productos/7", { precio: 25 }]]);
  const borrar = await peticionesDe(() => cli(["borrar-productos", "7", "--aplicar"]));
  assert.deepEqual(borrar.peticiones.map((p) => [p.metodo, p.url, p.cuerpo]), [["DELETE", "/api/productos/7", undefined]]);
  assert.deepEqual([borrar.corrida.codigo, borrar.corrida.json["estado"], borrar.corrida.json["respuesta"]], [0, 204, null]);
});

test("node: el cuerpo se comprueba contra la forma del contrato antes de llamar (2 sin petición) y avisa de lo que no conoce", async () => {
  const falta = await peticionesDe(() => cli(["crear-productos", '--cuerpo={"nombre":"Gorra"}', "--aplicar"]));
  assert.equal(falta.corrida.codigo, 2);
  assert.match(falta.corrida.json["error"], /falta precio \(numero\), etiquetas \(lista\), categoriaId \(entero\).*esquemaProducto/);
  assert.equal(falta.corrida.json["reintentable"], false);
  assert.deepEqual(falta.peticiones, []);
  const noJson = await cli(["crear-productos", "--cuerpo=no es json"]);
  assert.equal(noJson.codigo, 2);
  const sinCuerpo = await cli(["crear-productos"]);
  assert.equal(sinCuerpo.codigo, 2);
  assert.match(sinCuerpo.json["error"], /Falta «cuerpo»/);
  const raro = await cli(["crear-productos", '--cuerpo={"nombre":"Gorra","precio":"caro","etiquetas":[],"categoriaId":1,"color":"rojo"}']);
  assert.equal(raro.codigo, 0);
  assert.deepEqual(raro.json["avisos"], ["«precio» debería ser numero.", "El contrato no conoce color: se envía igual."]);
});

test("node: cada respuesta de error del servidor sale con su código del contrato, su salida y la respuesta", async () => {
  const casos: [string[], number, boolean][] = [
    [["leer-productos", "99"], 2, false],
    [["crear-productos", '--cuerpo={"nombre":"x","precio":1,"etiquetas":[],"categoriaId":1}', "--aplicar"], 2, false],
    [["crear-contacto", "--cuerpo={}", "--aplicar"], 5, false],
    [["crear-ordenes", '--cuerpo={"email":"a@b.c","total":3}', "--aplicar"], 4, true],
    [["leer-productos", "500"], 3, true],
  ];
  for (const [argv, codigo, reintentable] of casos) {
    const r = await cli(argv);
    assert.equal(r.codigo, codigo, `${argv.join(" ")}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json["reintentable"], reintentable, argv.join(" "));
    assert.equal(typeof r.json["error"], "string");
    assert.equal(typeof r.json["salida"], "string");
    assert.equal(r.json["esquema"], 1);
    assert.ok(r.json["respuesta"] !== undefined && typeof r.json["estado"] === "number");
  }
  const noEsta = await cli(["leer-productos", "99"]);
  assert.match(noEsta.json["error"], /respondió 404: Producto no encontrado/);
});

test("node: sin servidor sale con 3 reintentable y dice que lo levanten; una URL base rota es un 2; sin variable usa la del contrato", async () => {
  const caido = await cli(["leer-productos", "7"], `http://127.0.0.1:${await puertoCerrado()}`);
  assert.equal(caido.codigo, 3);
  assert.equal(caido.json["reintentable"], true);
  assert.match(caido.json["salida"], /levantado el servidor.*AX_BASE_URL/);
  const rota = await cli(["leer-productos", "7"], "nada de url");
  assert.equal(rota.codigo, 2);
  const porDefecto = await cli(["crear-productos", '--cuerpo={"nombre":"Gorra","precio":1,"etiquetas":[],"categoriaId":1}'], null);
  assert.equal(porDefecto.json["peticion"]["url"], "http://localhost:3000/api/productos");
});

test("mcp: las tools envuelven al CLI y llegan al servidor con el AX_BASE_URL del entorno", async () => {
  const anterior = process.env["AX_BASE_URL"];
  process.env["AX_BASE_URL"] = BASE;
  try {
    const h = (await import(pathToFileURL(join(raiz, "ax/mcp/herramientas.mjs")).href)) as {
      listar(): { name: string; annotations: Record<string, boolean> }[];
      llamar(nombre: string, args?: unknown): Promise<{ esError: boolean; codigo: number | null; json: Record<string, any> }>;
    };
    const tools = h.listar();
    assert.equal(tools.length, 8);
    assert.ok(tools.every((t) => t.annotations["openWorldHint"] === true));
    const leer = await peticionesDe(async () => {
      const r = await h.llamar("leer-productos", { id: "7" });
      return { codigo: r.codigo, json: r.json };
    });
    assert.deepEqual([leer.corrida.codigo, leer.corrida.json["estado"]], [0, 200]);
    assert.deepEqual(leer.peticiones.map((p) => `${p.metodo} ${p.url}`), ["GET /api/productos/7"]);
    const noEsta = await h.llamar("leer-productos", { id: "99" });
    assert.deepEqual([noEsta.esError, noEsta.codigo], [true, 2]);
    const crear = await peticionesDe(async () => {
      const r = await h.llamar("crear-productos", { cuerpo: JSON.stringify({ nombre: "Gorra", precio: 1, etiquetas: [], categoriaId: 1 }), aplicar: true });
      return { codigo: r.codigo, json: r.json };
    });
    assert.deepEqual(crear.peticiones.map((p) => p.metodo), ["POST"]);
  } finally {
    if (anterior === undefined) delete process.env["AX_BASE_URL"];
    else process.env["AX_BASE_URL"] = anterior;
  }
});

// --- el mismo contrato con el CLI en Python ---

function contratoDe(ruta: string): Contrato {
  const inventario = analizar(lectorDeDisco(ruta));
  return generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
}

test("python: las mismas llamadas, el mismo ensayo y los mismos códigos", { skip: HAY_PYTHON ? false : "python3 no está en esta máquina" }, async () => {
  const raizPy = copia("next-prisma");
  const base = contratoDe(raizPy);
  const contrato: Contrato = { ...base, cli: { ...base.cli, lenguaje: "python", ruta: "ax/cli.py", programa: "python3", argumentos: ["ax/cli.py"] } };
  aplicar(raizPy, contrato.huella, archivosCli(contrato));
  const py = (argv: string[], url: string = BASE) => correr(raizPy, "python3", ["ax/cli.py", ...argv], url);

  const leer = await peticionesDe(() => py(["leer-productos", "7"]));
  assert.equal(leer.corrida.codigo, 0, JSON.stringify(leer.corrida.json));
  assert.deepEqual(leer.peticiones.map((p) => `${p.metodo} ${p.url}`), ["GET /api/productos/7"]);
  assert.deepEqual(leer.corrida.json["respuesta"], { data: { id: 7, nombre: "Camiseta" }, error: null });

  const listar = await peticionesDe(() => py(["listar-productos", "--categoria=grande"]));
  assert.deepEqual(listar.peticiones.map((p) => p.url), ["/api/productos?categoria=grande"]);
  assert.equal(listar.corrida.json["truncado"], true);
  assert.equal(listar.corrida.json["total"], 300);

  const docs = await peticionesDe(() => py(["leer-docs", "guia/primeros pasos"]));
  assert.deepEqual(docs.peticiones.map((p) => p.url), ["/api/docs/guia/primeros%20pasos"]);

  const cuerpo = JSON.stringify({ nombre: "Gorra", precio: 20, etiquetas: [], categoriaId: 1 });
  const ensayo = await peticionesDe(() => py(["crear-productos", `--cuerpo=${cuerpo}`]));
  assert.deepEqual([ensayo.corrida.codigo, ensayo.corrida.json["ensayo"], ensayo.peticiones.length], [0, true, 0]);
  const hecho = await peticionesDe(() => py(["crear-productos", `--cuerpo=${cuerpo}`, "--aplicar"]));
  assert.deepEqual(hecho.peticiones, [{ metodo: "POST", url: "/api/productos", tipo: "application/json", cuerpo: JSON.parse(cuerpo) }]);
  assert.deepEqual([hecho.corrida.codigo, hecho.corrida.json["estado"]], [0, 201]);
  const borrar = await py(["borrar-productos", "7", "--aplicar"]);
  assert.deepEqual([borrar.codigo, borrar.json["estado"], borrar.json["respuesta"]], [0, 204, null]);

  const falta = await peticionesDe(() => py(["crear-productos", '--cuerpo={"nombre":"Gorra"}', "--aplicar"]));
  assert.deepEqual([falta.corrida.codigo, falta.peticiones.length], [2, 0]);
  for (const [argv, codigo] of [[["leer-productos", "99"], 2], [["crear-contacto", "--cuerpo={}", "--aplicar"], 5], [["crear-ordenes", '--cuerpo={"email":"a","total":1}', "--aplicar"], 4], [["leer-productos", "500"], 3]] as const) {
    const r = await py([...argv]);
    assert.equal(r.codigo, codigo, `${argv.join(" ")}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json["esquema"], 1);
  }
  const caido = await py(["leer-productos", "7"], `http://127.0.0.1:${await puertoCerrado()}`);
  assert.deepEqual([caido.codigo, caido.json["reintentable"]], [3, true]);
});

test("next-pages: el Pages Router también se genera y su CLI llama a la ruta de pages/api", async () => {
  const raizPages = copia("next-pages");
  const ensayo = axd("generar", "cli", raizPages);
  assert.equal(ensayo.codigo, 0, JSON.stringify(ensayo.json));
  axd("generar", "cli", raizPages, "--aplicar", "--huella", ensayo.json["huella_del_destino"]);
  const r = await peticionesDe(() => correr(raizPages, process.execPath, ["ax/cli.mjs", "listar-tareas", "--estado=hecha"]));
  assert.deepEqual(r.peticiones.map((p) => `${p.metodo} ${p.url}`), ["GET /api/tareas?estado=hecha"]);
});

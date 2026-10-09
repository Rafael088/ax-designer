import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const CLI = join(RAIZ, "src", "cli", "main.ts");

function axd(...argumentos: string[]) {
  return axdEn(RAIZ, ...argumentos);
}

function axdEn(cwd: string, ...argumentos: string[]) {
  return axdCon({}, cwd, ...argumentos);
}

function axdCon(entorno: Record<string, string>, cwd: string, ...argumentos: string[]) {
  const corrida = spawnSync(process.execPath, [CLI, ...argumentos], { encoding: "utf8", cwd, env: { ...process.env, ...entorno } });
  return { codigo: corrida.status, json: JSON.parse(corrida.stdout) as Record<string, unknown> };
}

test("--version responde JSON con el esquema y la versión de package.json", () => {
  const { codigo, json } = axd("--version");
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  assert.equal(json["nombre"], "axd");
  const versionReal = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).version as string;
  assert.equal(json["version"], versionReal, "VERSION en src/cli/main.ts se separó de package.json");
});

test("--help responde JSON con los verbos de axd", () => {
  const { codigo, json } = axd("--help");
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  const verbos = json["verbos"] as { verbo: string }[];
  assert.deepEqual(
    verbos.map((v) => v.verbo.split(" ")[0]).sort(),
    ["analizar", "auditar", "contrato", "estado", "generar", "medir", "validar"],
  );
});

test("sin argumentos es uso incorrecto: código 2 con error accionable", () => {
  const { codigo, json } = axd();
  assert.equal(codigo, 2);
  assert.equal(json["esquema"], 1);
  assert.ok(typeof json["error"] === "string" && json["error"].length > 0);
  assert.ok(typeof json["salida"] === "string" && json["salida"].includes("axd --help"));
  assert.equal(json["reintentable"], false);
});

test("un verbo desconocido es uso incorrecto: código 2", () => {
  const { codigo, json } = axd("volary");
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /volary/);
});

const NODE_CLI = join(RAIZ, "pruebas", "repos", "node-cli");

test("analizar sin ruta analiza la carpeta actual y devuelve el Inventario con esquema 1", () => {
  const { codigo, json } = axdEn(NODE_CLI, "analizar");
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  assert.equal(json["raiz"], ".");
  assert.equal((json["guias"] as unknown[]).length, 3);
});

test("analizar con una ruta que no existe es uso incorrecto con la salida", () => {
  const { codigo, json } = axd("analizar", join(RAIZ, "pruebas", "repos", "no-existe"));
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /No existe/);
  assert.ok((json["salida"] as string).includes("axd analizar"));
  assert.equal(json["reintentable"], false);
});

test("analizar con dos rutas o una bandera desconocida es uso incorrecto", () => {
  assert.equal(axd("analizar", NODE_CLI, NODE_CLI).codigo, 2);
  assert.equal(axd("analizar", "--recursivo", NODE_CLI).codigo, 2);
});

test("medir devuelve la Medicion con esquema 1, sus caminos y sus métricas", () => {
  const { codigo, json } = axd("medir", NODE_CLI);
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  assert.equal(json["raiz"], NODE_CLI);
  const caminos = json["caminos"] as { id: string }[];
  assert.ok(caminos.some((c) => c.id === "guia-de-entrada"));
  assert.ok(caminos.some((c) => c.id === "lectura-todo"));
  const metricas = json["metricas"] as Record<string, number | null>;
  for (const clave of ["tokens_guia_de_entrada", "tokens_resumen", "tokens_camino_caro", "razon_caro_barato"]) {
    assert.ok(clave in metricas, `falta la métrica ${clave}`);
  }
});

test("medir sobre una ruta inexistente sale con código 2 y dice cómo corregirlo", () => {
  const { codigo, json } = axd("medir", join(RAIZ, "pruebas", "repos", "no-existe"));
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /No existe/);
});

test("auditar devuelve el Informe con esquema 1, los 7 ejes y los hallazgos ordenados", () => {
  const { codigo, json } = axd("auditar", NODE_CLI);
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  assert.equal(json["raiz"], NODE_CLI);
  const ejes = json["ejes"] as { id: string }[];
  assert.equal(ejes.length, 7);
  assert.ok(typeof json["puntuacion_global"] === "number");
  assert.ok(Array.isArray(json["hallazgos"]));
});

test("auditar no escribe ni gasta: el repo de mentira queda igual", () => {
  const antes = readFileSync(join(NODE_CLI, "data", "estado.json"), "utf8");
  axd("auditar", NODE_CLI);
  assert.equal(readFileSync(join(NODE_CLI, "data", "estado.json"), "utf8"), antes);
});

test("auditar --formato md imprime prosa, no JSON, y sigue en código 0", () => {
  const corrida = spawnSync(process.execPath, [CLI, "auditar", NODE_CLI, "--formato", "md"], { encoding: "utf8" });
  assert.equal(corrida.status, 0);
  assert.match(corrida.stdout, /^# Auditoría AX/);
  assert.throws(() => JSON.parse(corrida.stdout));
});

test("auditar con --formato desconocido es uso incorrecto: código 2", () => {
  const { codigo, json } = axd("auditar", NODE_CLI, "--formato", "xml");
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /xml/);
});

test("auditar con dos rutas es uso incorrecto", () => {
  assert.equal(axd("auditar", NODE_CLI, NODE_CLI).codigo, 2);
});

test("auditar sobre una ruta inexistente sale con código 2", () => {
  const { codigo, json } = axd("auditar", join(RAIZ, "pruebas", "repos", "no-existe"));
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /No existe/);
});

test("contrato devuelve el Contrato con esquema 1, su huella, sus verbos y cómo se invoca el CLI", () => {
  const { codigo, json } = axd("contrato", NODE_CLI);
  assert.equal(codigo, 0);
  assert.equal(json["esquema"], 1);
  assert.match(json["huella"] as string, /^[0-9a-f]{64}$/);
  assert.deepEqual((json["verbos"] as { nombre: string }[]).map((v) => v.nombre), ["estado", "listar", "entregar"]);
  assert.equal((json["cli"] as { ruta: string }).ruta, "ax/cli.mjs");
});

test("contrato con dos rutas o una ruta que no existe es uso incorrecto", () => {
  assert.equal(axd("contrato", NODE_CLI, NODE_CLI).codigo, 2);
  assert.equal(axd("contrato", join(RAIZ, "pruebas", "repos", "no-existe")).codigo, 2);
});

test("generar sin generador, con uno desconocido, con dos rutas o --huella sin --aplicar es uso incorrecto", () => {
  for (const argumentos of [["generar"], ["generar", "xml", NODE_CLI], ["generar", "mcp", NODE_CLI, NODE_CLI], ["generar", "mcp", NODE_CLI, "--huella", "x"], ["generar", "mcp", "--forzar"]]) {
    const { codigo, json } = axd(...argumentos);
    assert.equal(codigo, 2, argumentos.join(" "));
    assert.ok((json["salida"] as string).length > 0);
  }
});

test("generar mcp sin --aplicar es un ensayo: dice qué crearía y no escribe en el repo", () => {
  const { codigo, json } = axd("generar", "mcp", NODE_CLI);
  assert.equal(codigo, 0);
  assert.equal(json["ensayo"], true);
  const archivos = json["archivos"] as { ruta: string; accion: string }[];
  assert.deepEqual(archivos.map((a) => [a.ruta, a.accion]), [
    ["ax/contrato.json", "crear"], ["ax/mcp/herramientas.mjs", "crear"], ["ax/mcp/servidor.mjs", "crear"], ["ax/mcp/package.json", "crear"], ["ax/mcp/README.md", "crear"],
  ]);
  assert.match(json["salida"] as string, /--aplicar --huella [0-9a-f]{64}/);
  assert.equal(existsSync(join(NODE_CLI, "ax")), false);
});

test("generar cli sin --aplicar es un ensayo: el contrato, el CLI de contrato.cli.ruta y su README, sin escribir", () => {
  const { codigo, json } = axd("generar", "cli", NODE_CLI);
  assert.equal(codigo, 0);
  assert.equal(json["ensayo"], true);
  assert.equal(json["generador"], "cli");
  assert.deepEqual((json["archivos"] as { ruta: string; accion: string }[]).map((a) => [a.ruta, a.accion]), [
    ["ax/contrato.json", "crear"], ["ax/cli.mjs", "crear"], ["ax/cli.md", "crear"],
  ]);
  assert.match(json["salida"] as string, /generar cli .* --aplicar --huella [0-9a-f]{64}/);
  assert.equal(existsSync(join(NODE_CLI, "ax")), false);
});

test("generar cli --aplicar escribe y la salida dice cómo probarlo; pisar un CLI editado a mano es un 5", () => {
  const repo = copiaDeNodeCli();
  const { codigo, json } = axd("generar", "cli", repo, "--aplicar");
  assert.equal(codigo, 0);
  assert.equal((json["escritos"] as unknown[]).length, 3);
  assert.match(json["salida"] as string, /node ax\/cli\.mjs --help/);
  writeFileSync(join(repo, "ax", "cli.mjs"), readFileSync(join(repo, "ax", "cli.mjs"), "utf8") + "// a mano\n");
  assert.equal(axd("generar", "cli", repo).codigo, 5);
  assert.equal(axd("generar", "cli", repo, "--aplicar").codigo, 5);
});

function copiaDeNodeCli(): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-cli-")), "node-cli");
  cpSync(NODE_CLI, destino, { recursive: true });
  return destino;
}

test("generar mcp --aplicar con la huella del ensayo escribe y devuelve lo escrito; repetirlo no cambia nada", () => {
  const repo = copiaDeNodeCli();
  const ensayo = axd("generar", "mcp", repo).json;
  const { codigo, json } = axd("generar", "mcp", repo, "--aplicar", "--huella", ensayo["huella_del_destino"] as string);
  assert.equal(codigo, 0);
  assert.equal(json["ensayo"], false);
  const escritos = json["escritos"] as { ruta: string; sha256: string }[];
  assert.equal(escritos.length, 5);
  assert.ok(escritos.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)));
  const otra = axd("generar", "mcp", repo, "--aplicar");
  assert.equal(otra.codigo, 0);
  assert.deepEqual(otra.json["escritos"], []);
  assert.equal((otra.json["sin_cambios"] as string[]).length, 5);
  assert.equal(axd("contrato", repo).json["huella"], axd("contrato", NODE_CLI).json["huella"], "lo generado no cambia el contrato");
});

test("generar mcp --aplicar sale con 4 si el destino cambió desde el ensayo, y con 5 si pisaría algo ajeno", () => {
  const repo = copiaDeNodeCli();
  const ensayo = axd("generar", "mcp", repo).json;
  cpSync(join(repo, "README.md"), join(repo, "ax", "mcp", "README.md"));
  const cambio = axd("generar", "mcp", repo, "--aplicar", "--huella", ensayo["huella_del_destino"] as string);
  assert.equal(cambio.codigo, 4);
  assert.equal(cambio.json["reintentable"], true);
  const ajeno = axd("generar", "mcp", repo);
  assert.equal(ajeno.codigo, 5, "el ensayo falla donde fallaría aplicar");
  assert.deepEqual((ajeno.json["archivos"] as { ruta: string }[]).map((a) => a.ruta), ["ax/mcp/README.md"]);
  assert.equal(axd("generar", "mcp", repo, "--aplicar").codigo, 5);
  assert.equal(existsSync(join(repo, "ax", "mcp", "servidor.mjs")), false);
  assert.equal(readFileSync(join(repo, "ax", "mcp", "README.md"), "utf8"), readFileSync(join(repo, "README.md"), "utf8"), "no pisó el ajeno");
});

// validar: siempre con --motor mentira o sin --correr. Ninguna prueba lanza un agente de verdad.
const TAREAS = join(RAIZ, "pruebas", "validador", "node-cli.tareas.json");

test("validar sin --correr es el ensayo: el plan con su costo estimado, sin escribir ni gastar", () => {
  const repo = join(mkdtempSync(join(tmpdir(), "axd-cli-validar-")), "node-cli");
  cpSync(NODE_CLI, repo, { recursive: true });
  const { codigo, json } = axd("validar", repo, "--tareas", TAREAS, "--motor", "mentira", "--repeticiones", "2");
  assert.equal(codigo, 0, JSON.stringify(json));
  assert.equal(json["ensayo"], true);
  assert.equal((json["corridas"] as unknown[]).length, 8);
  const total = json["total"] as { usd: number; usd_tope: number };
  assert.ok(total.usd > 0 && total.usd_tope === 5);
  assert.match(json["salida"] as string, /--correr/);
  assert.ok(!existsSync(join(repo, ".ax-corridas")), "el ensayo no escribe");
});

test("validar --con cli: el plan lo dice y el «con» estima leer ax/cli.md en vez de las tools del MCP", () => {
  const { codigo, json } = axd("validar", NODE_CLI, "--tareas", TAREAS, "--motor", "mentira", "--con", "cli");
  assert.equal(codigo, 0, JSON.stringify(json));
  assert.equal(json["con"], "cli");
  assert.match(json["salida"] as string, /--con cli --correr/);
  const con = (json["corridas"] as { variante: string; estimacion: { lecturas: { que: string }[] } }[]).find((c) => c.variante === "con")!;
  const lecturas = con.estimacion.lecturas.map((l) => l.que).join(" | ");
  assert.match(lecturas, /ax\/cli\.md, una vez/);
  assert.match(lecturas, /línea de la guía/);
  assert.doesNotMatch(lecturas, /tools del MCP/);
  assert.equal(axd("validar", NODE_CLI, "--tareas", TAREAS, "--motor", "mentira").json["con"], "ambos", "por defecto, ambos");
});

test("validar: los errores de uso salen con 2", () => {
  const casos: [string[], RegExp][] = [
    [["validar", NODE_CLI], /--tareas/],
    [["validar", NODE_CLI, "--tareas", TAREAS, "--motor", "gpt"], /--motor «gpt»/],
    [["validar", NODE_CLI, "--tareas", TAREAS, "--repeticiones", "dos"], /--repeticiones/],
    [["validar", NODE_CLI, "--tareas", TAREAS, "--repeticiones", "11"], /no puede pasar de 10/],
    [["validar", NODE_CLI, "--tareas", join(RAIZ, "no-existe.json")], /archivo de tareas/],
    [["validar", NODE_CLI, "--tareas", join(RAIZ, "package.json")], /esquema/],
    [["validar", NODE_CLI, "otro", "--tareas", TAREAS], /una sola ruta/],
    [["validar", NODE_CLI, "--tareas", TAREAS, "--con", "todo"], /--con «todo».*cli, mcp, ambos/],
  ];
  for (const [argumentos, mensaje] of casos) {
    const { codigo, json } = axd(...argumentos);
    assert.equal(codigo, 2, argumentos.join(" "));
    assert.match(json["error"] as string, mensaje);
    assert.equal(typeof json["salida"], "string");
  }
});

test("validar con el motor claude y sin claude en el PATH sale con 3, dice qué hacer y trae el plan", () => {
  // PATH vacío: el motor no encuentra claude y no puede lanzarlo. Y sin --correr: nunca correría.
  const { codigo, json } = axdCon({ PATH: "" }, RAIZ, "validar", NODE_CLI, "--tareas", TAREAS);
  assert.equal(codigo, 3);
  assert.match(json["error"] as string, /claude/);
  assert.match(json["salida"] as string, /Instala Claude Code/);
  assert.equal((json["plan"] as { motor: string }).motor, "claude");
});

test("validar --correr con el motor de mentira deja la comparación en .ax-corridas/ del repo", () => {
  const repo = join(mkdtempSync(join(tmpdir(), "axd-cli-validar-")), "node-cli");
  cpSync(NODE_CLI, repo, { recursive: true });
  const { codigo, json } = axd("validar", repo, "--tareas", TAREAS, "--motor", "mentira", "--correr");
  assert.equal(codigo, 0, JSON.stringify(json));
  assert.equal(json["ensayo"], false);
  const escrito = json["escrito"] as { ruta: string; sha256: string };
  assert.match(escrito.ruta, /^\.ax-corridas\/.+\.json$/);
  const guardado = JSON.parse(readFileSync(join(repo, escrito.ruta), "utf8"));
  assert.deepEqual(guardado.comparacion, json["comparacion"]);
  assert.equal((json["resultados"] as unknown[]).length, 4);
});

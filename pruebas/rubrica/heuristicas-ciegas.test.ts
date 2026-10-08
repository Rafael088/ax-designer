// Heurísticas que seguían ciegas al auditar un gestor de tareas en Python: cada una contra un
// repo en memoria que imita su patrón, nunca contra un repo real ni contra este.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analizar, lectorEnMemoria } from "../../src/analizador/index.ts";
import { clavesDe } from "../../src/analizador/datos.ts";
import { evaluar as evaluarLecturaBarata } from "../../src/rubrica/lectura-barata.ts";
import { evaluar as evaluarVerbosEstrechos } from "../../src/rubrica/verbos-estrechos.ts";
import { evaluar as evaluarContextoProgresivo } from "../../src/rubrica/contexto-progresivo.ts";
import { evaluar as evaluarEvidenciaYTrazabilidad } from "../../src/rubrica/evidencia-y-trazabilidad.ts";
import { medir } from "../../src/medicion/index.ts";
import type { CriterioDecidido } from "../../src/modelo/index.ts";

function porId(criterios: CriterioDecidido[]): Record<string, CriterioDecidido> {
  return Object.fromEntries(criterios.map((c) => [c.id, c]));
}

const CLI_CON_ID = 'import argparse\np = argparse.ArgumentParser()\np.add_argument("--id")\n';

// --- (1) ids de bloque de Obsidian en el cuerpo de un Markdown ---

const TAREAS_CON_ID = [
  "# Tareas",
  "",
  "- [x] Configurar el CI #dificil — 2026-10-01 ^tarea-6fr6pd",
  "- [ ] Comprar el dominio #facil ^tarea-u30jwo",
  "- [ ] Página web #medio ^tarea-79cfp8",
  "",
].join("\n");

test("(1) clavesDe: una lista de tareas con ^id al final de cada línea tiene id, sin frontmatter", () => {
  assert.deepEqual(clavesDe("markdown", TAREAS_CON_ID).claves, ["id"]);
  assert.deepEqual(clavesDe("markdown", `---\nid: x\nfecha: 2026-10-01\n---\n${TAREAS_CON_ID}`).claves, ["id", "fecha"], "no duplica la del frontmatter");
});

test("(1) clavesDe: un ^ancla suelto para enlazar un párrafo no es un id de las entidades", () => {
  const notas = ["# Notas", "", "- una idea", "- otra idea", "- una tercera ^ancla", "", "Un párrafo enlazable ^parrafo"].join("\n");
  assert.equal(clavesDe("markdown", notas).claves, undefined);
  assert.equal(clavesDe("markdown", "# Sin lista\n\nTexto ^ancla\n").claves, undefined);
});

test("(1) identificadores-estables: datos/tareas.md con ^ids cuenta como entidad con id", () => {
  const decision = "---\nid: dec-a1b2\nfecha: 2026-10-01\n---\n# Una decisión\n";
  const conIds = analizar(lectorEnMemoria({ "datos/tareas.md": TAREAS_CON_ID, "datos/decisiones/una.md": decision, "cli.py": CLI_CON_ID }));
  assert.deepEqual(conIds.estado.find((e) => e.ruta === "datos/tareas.md")?.claves, ["id"]);
  const c = porId(evaluarContextoProgresivo(conIds, medir(conIds)))["contexto-progresivo/identificadores-estables"]!;
  assert.equal(c.resultado, "cumple", c.motivo);

  const sinIds = analizar(lectorEnMemoria({ "datos/tareas.md": TAREAS_CON_ID.replace(/ \^tarea-\w+/g, ""), "datos/decisiones/una.md": decision }));
  const d = porId(evaluarContextoProgresivo(sinIds, medir(sinIds)))["contexto-progresivo/identificadores-estables"]!;
  assert.equal(d.resultado, "parcial");
  assert.match(d.motivo, /1 de 2 archivos; sin id, datos\/tareas\.md/, "el parcial nombra el archivo sin id");
});

// --- (3b) bitácora de un Markdown por día con frontmatter fecha ---

function dia(fecha: string, lineas: string[]): string {
  return [`---\nfecha: ${fecha}\n---\n# ${fecha}\n`, ...lineas.map((l) => `- ${l}`), ""].join("\n");
}

test("(3b) una carpeta bitacora/ de AAAA-MM-DD.md es una sola bitácora, con sus días y registros", () => {
  const inv = analizar(lectorEnMemoria({
    "bitacora/2026-10-03.md": dia("2026-10-03", ["Release 1.2", "Arreglo de Windows"]),
    "bitacora/2026-10-04.md": dia("2026-10-04", ["Auditoría de seguridad"]),
    "bitacora/2026-09-30.md": dia("2026-09-30", ["Planning"]),
    "docs/2026-10-04.md": "# Un documento con fecha, no una bitácora\n- algo\n",
    "notas/bitacora.md": "# Sin fecha en el nombre\n",
  }));
  assert.deepEqual(inv.trazabilidad.bitacoras, [{ ruta: "bitacora/2026-10-04.md", registros: 4, claves: ["fecha"], archivos: 3 }]);
  const c = porId(evaluarEvidenciaYTrazabilidad(inv))["evidencia-y-trazabilidad/registro-de-quien-hizo-que"]!;
  assert.equal(c.resultado, "parcial", "guarda la fecha pero no quién: parcial por la bitácora, no por «solo git»");
  assert.doesNotMatch(c.motivo, /solo queda el historial de git/);
  assert.equal(c.evidencia[0]?.tipo === "archivo" ? c.evidencia[0].ruta : undefined, "bitacora/2026-10-04.md");
});

test("(3b) una bitácora por día con autor en el frontmatter cumple registro-de-quien-hizo-que", () => {
  const inv = analizar(lectorEnMemoria({ "logs/2026-10-04.md": "---\nfecha: 2026-10-04\nautor: rafa\n---\n- algo\n" }));
  assert.equal(porId(evaluarEvidenciaYTrazabilidad(inv))["evidencia-y-trazabilidad/registro-de-quien-hizo-que"]!.resultado, "cumple");
});

test("(3b) los días de la bitácora no cuentan como entidades sin id en identificadores-estables", () => {
  const inv = analizar(lectorEnMemoria({
    "datos/tareas.md": TAREAS_CON_ID,
    "bitacora/2026-10-04.md": dia("2026-10-04", ["algo"]),
    "bitacora/2026-10-05.md": dia("2026-10-05", ["otra cosa"]),
    "cli.py": CLI_CON_ID,
  }));
  const c = porId(evaluarContextoProgresivo(inv, medir(inv)))["contexto-progresivo/identificadores-estables"]!;
  assert.equal(c.resultado, "cumple", c.motivo);
});

// --- (2) una bandera de evidencia que el parser exige (required=True) ---

const ENTREGAR_ARGPARSE = [
  "import argparse",
  "",
  "def cmd_entregar(args):",
  "    return 0",
  "",
  "def analizador():",
  "    p = argparse.ArgumentParser()",
  "    sub = p.add_subparsers(dest=\"comando\", required=True)",
  "    entregar = sub.add_parser(\"entregar\", help=\"Haciéndola → Para comprobar\")",
  "    entregar.add_argument(\"id\")",
  "    entregar.add_argument(\"--evidencia\", required=True,",
  "                          help=\"Archivos tocados, pruebas con su salida, commit\")",
  "    entregar.add_argument(\"--prueba\", action=\"append\", help=\"Repetible\")",
  "    entregar.set_defaults(funcion=cmd_entregar)",
  "    return p",
  "",
].join("\n");

test("(2) el analizador anota las banderas que el parser exige, y solo esas", () => {
  const inv = analizar(lectorEnMemoria({ "tareas/cli.py": ENTREGAR_ARGPARSE }));
  const entregar = inv.superficies.cli.find((v) => v.nombre === "entregar")!;
  assert.deepEqual(entregar.banderas, ["--evidencia", "--prueba"]);
  assert.deepEqual(entregar.banderas_requeridas, ["--evidencia"]);
  const js = analizar(lectorEnMemoria({
    "bin/cli.js": [
      "#!/usr/bin/env node",
      'import { Command } from "commander";',
      "const p = new Command();",
      'p.command("entregar").requiredOption("--evidencia <texto>").option("--prueba <cmd>");',
      'p.command("bloquear").option("--motivo <texto>", "Por qué", { required: true });',
      'p.command("tomar").option("--agente <a>");',
    ].join("\n"),
  }));
  const de = (n: string) => js.superficies.cli.find((v) => v.nombre === n)!;
  assert.deepEqual(de("entregar").banderas_requeridas, ["--evidencia"]);
  assert.deepEqual(de("bloquear").banderas_requeridas, ["--motivo"]);
  assert.equal("banderas_requeridas" in de("tomar"), false, "sin requeridas no se agrega la clave");
});

test("(2) entrega-con-evidencia cumple si argparse exige --evidencia con required=True", () => {
  const inv = analizar(lectorEnMemoria({ "tareas/cli.py": ENTREGAR_ARGPARSE }));
  const c = porId(evaluarEvidenciaYTrazabilidad(inv))["evidencia-y-trazabilidad/entrega-con-evidencia"]!;
  assert.equal(c.resultado, "cumple", c.motivo);
  assert.match(c.motivo, /exige --evidencia/);

  const opcional = analizar(lectorEnMemoria({ "tareas/cli.py": ENTREGAR_ARGPARSE.replace("required=True,", "default=None,") }));
  const d = porId(evaluarEvidenciaYTrazabilidad(opcional))["evidencia-y-trazabilidad/entrega-con-evidencia"]!;
  assert.equal(d.resultado, "parcial", "una --evidencia opcional sigue en parcial");
});

// --- (3a) un verbo de resumen que despacha a otro módulo, que es el que serializa ---

// El patrón de un gestor de tareas en Python: `sub.add_parser("estado")` sin set_defaults; el main lo despacha con un
// `if` a `estado.main()` (importado en un `from . import (...)` de varias líneas), y en
// tareas/estado.py `main()` llama a `calcular()`, que llama a `resumir()`, que pone
// `datos["esquema"] = ESQUEMA`; `main()` imprime con json.dumps. Todo fuera de la ventana de 20
// líneas tras el add_parser, y en otro archivo.
const CLI_PY = [
  "import argparse",
  "import json",
  "import sys",
  "",
  "from . import (__version__, bitacora,",
  "               estado, modelo)",
  "",
  "ESQUEMA = 1",
  "",
  "def imprimir(datos):",
  "    print(json.dumps(datos, ensure_ascii=False))",
  "",
  "def cmd_tomar(args):",
  "    tarea = modelo.tomar(args.id)",
  '    imprimir({"esquema": ESQUEMA, "cambio": True, "tarea": tarea})',
  "    return 0",
  "",
  "def analizador():",
  "    p = argparse.ArgumentParser()",
  '    sub = p.add_subparsers(dest="comando", required=True)',
  '    sub.add_parser("estado", help="Resumen con los conteos")',
  '    tomar = sub.add_parser("tomar", help="Pendiente → haciéndola")',
  '    tomar.add_argument("id")',
  '    tomar.add_argument("--agente", required=True)',
  "    tomar.set_defaults(funcion=cmd_tomar)",
  "    return p",
  "",
  "def main(argumentos=None):",
  "    argumentos = sys.argv[1:] if argumentos is None else list(argumentos)",
  '    if argumentos[:1] in (["--estado"], ["estado"]):',
  "        return estado.main()",
  "    args = analizador().parse_args(argumentos)",
  "    return args.funcion(args)",
  "",
].join("\n");

const ESTADO_PY = [
  '"""Resumen de tareas para el widget de la barra."""',
  "import json",
  "",
  "ESQUEMA = 1",
  "",
  "def resumir(proyectos):",
  "    datos = {\"tareas\": len(proyectos)}",
  '    datos["esquema"] = ESQUEMA',
  "    return datos",
  "",
  "def calcular():",
  "    return resumir([])",
  "",
  "def main():",
  "    datos = calcular()",
  "    print(json.dumps(datos, ensure_ascii=False))",
  "",
].join("\n");

const GUIA = "# Agentes\n\n`tareas estado` da el resumen en JSON. Las claves se agregan, no se renombran.\n";

function gestorEnMemoria(estado = ESTADO_PY) {
  return analizar(lectorEnMemoria({ "tareas/__init__.py": "", "tareas/cli.py": CLI_PY, "tareas/estado.py": estado, "AGENTS.md": GUIA }));
}

test("(3a) el verbo argparse despachado por un if a otro módulo lleva su manejador en ese módulo", () => {
  const inv = gestorEnMemoria();
  const de = (n: string) => inv.superficies.cli.find((v) => v.nombre === n)!.manejador;
  const lineas = ESTADO_PY.split("\n");
  const estado = de("estado")!;
  assert.equal(estado.archivo, "tareas/estado.py");
  assert.equal(lineas[estado.linea - 1], "def main():");
  assert.deepEqual((estado.llama ?? []).map((r) => lineas[r.linea - 1]), ["def calcular():", "def resumir(proyectos):"], "sigue main → calcular → resumir");
  const tomar = de("tomar")!;
  assert.equal(tomar.archivo, undefined, "set_defaults a una función local: mismo archivo");
  assert.equal(CLI_PY.split("\n")[tomar.linea - 1], "def cmd_tomar(args):");
  assert.deepEqual((tomar.llama ?? []).map((r) => CLI_PY.split("\n")[r.linea - 1]), ["def imprimir(datos):"]);
});

test("(3a) lectura-barata ve el JSON y el esquema del resumen aunque vivan en otro módulo", () => {
  const inv = gestorEnMemoria();
  const c = porId(evaluarLecturaBarata(inv, medir(inv)));
  assert.equal(c["lectura-barata/formato-de-maquina"]!.resultado, "cumple", c["lectura-barata/formato-de-maquina"]!.motivo);
  assert.equal(c["lectura-barata/esquema-versionado"]!.resultado, "cumple", c["lectura-barata/esquema-versionado"]!.motivo);
  const ev = c["lectura-barata/esquema-versionado"]!.evidencia[0];
  assert.deepEqual(ev, { tipo: "archivo", ruta: "tareas/estado.py", linea: 8 }, "la evidencia es datos[\"esquema\"] = ESQUEMA en resumir()");

  const sinJson = gestorEnMemoria(ESTADO_PY.replace("print(json.dumps(datos, ensure_ascii=False))", "print(datos)").replace('    datos["esquema"] = ESQUEMA\n', ""));
  const d = porId(evaluarLecturaBarata(sinJson, medir(sinJson)));
  assert.equal(d["lectura-barata/formato-de-maquina"]!.resultado, "no-cumple", "si el otro módulo no serializa, sigue en no-cumple");
  assert.equal(d["lectura-barata/esquema-versionado"]!.resultado, "no-cumple");
});

test("(3a) devuelve-estado-nuevo sigue set_defaults hasta imprimir() del mismo módulo", () => {
  const inv = gestorEnMemoria();
  const c = porId(evaluarVerbosEstrechos(inv))["verbos-estrechos/devuelve-estado-nuevo"]!;
  assert.equal(c.resultado, "cumple", c.motivo);
});

test("(3a) en TS/JS el case sigue a una función importada, con import * as o con import { }", () => {
  const cli = [
    "#!/usr/bin/env node",
    'import * as estado from "./estado.ts";',
    'import { generar as gen } from "./generar.ts";',
    "switch (process.argv[2]) {",
    '  case "estado":',
    "    estado.resumen();",
    "    break;",
    '  case "generar":',
    "    gen();",
    "    break;",
    "}",
  ].join("\n");
  const estadoTs = ["export function resumen() {", "  imprimir({ esquema: 1, tareas: 3 });", "}", "function imprimir(r) {", "  console.log(JSON.stringify(r));", "}", ""].join("\n");
  const generarTs = ["export function generar() {", '  return { escritos: [], salida: "Escrito." };', "}", ""].join("\n");
  const inv = analizar(lectorEnMemoria({ "bin/cli.ts": cli, "bin/estado.ts": estadoTs, "bin/generar.ts": generarTs }));
  const de = (n: string) => inv.superficies.cli.find((v) => v.nombre === n)!.manejador;
  assert.deepEqual(de("estado"), { archivo: "bin/estado.ts", linea: 1, hasta: 3, llama: [{ linea: 4, hasta: 6 }] });
  assert.deepEqual(de("generar"), { archivo: "bin/generar.ts", linea: 1, hasta: 3 });
});

test("(3a) la señal clave-de-esquema ve la asignación por subíndice, no la comparación", () => {
  const inv = analizar(lectorEnMemoria({ "m.py": 'datos["esquema"] = ESQUEMA\nif datos["esquema"] == 1:\n    pass\nd[\'schema_version\']=2\n' }));
  assert.deepEqual(inv.senales.filter((s) => s.tipo === "clave-de-esquema").map((s) => s.linea), [1, 4]);
});

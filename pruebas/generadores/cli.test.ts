// El CLI generado, escrito en copias temporales de los repos de mentira y ejecutado de verdad:
// lecturas, ensayo, aplicar, huella vieja (4), vedadas y verbos sin implementar (5) y errores de
// uso (2). Nunca contra este repo. La versión de Python corre con python3 si está; si no, se salta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { generarContrato, jsonCanonico, sha256 } from "../../src/contrato/index.ts";
import { aplicar, archivosCli, leerCabecera } from "../../src/generadores/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import { ErrorAx, type Contrato } from "../../src/modelo/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";

const REPOS = join(import.meta.dirname, "..", "repos");

function contratoDe(ruta: string): Contrato {
  const inventario = analizar(lectorDeDisco(ruta));
  return generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
}

function copia(repo: string): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-cli-gen-")), repo);
  cpSync(join(REPOS, repo), destino, { recursive: true });
  return destino;
}

/** El mismo contrato, pero pidiendo el CLI en Python: para correr las dos versiones sobre el mismo dominio. */
function enPython(contrato: Contrato): Contrato {
  return { ...contrato, cli: { ...contrato.cli, lenguaje: "python", ruta: "ax/cli.py", programa: "python3", argumentos: ["ax/cli.py"] } };
}

type Corrida = { codigo: number | null; json: Record<string, any> };

function corredor(raiz: string, contrato: Contrato) {
  return (...argumentos: string[]): Corrida => {
    const programa = contrato.cli.programa === "node" ? process.execPath : contrato.cli.programa;
    const r = spawnSync(programa, [...contrato.cli.argumentos, ...argumentos], { cwd: raiz, encoding: "utf8" });
    assert.equal(r.stderr, "", `stderr de ${argumentos.join(" ")}: ${r.stderr}`);
    const lineas = r.stdout.trim().split("\n");
    assert.equal(lineas.length, 1, "una sola línea de JSON por stdout");
    return { codigo: r.status, json: JSON.parse(lineas[0]!) };
  };
}

function preparar(repo: string, transformar: (c: Contrato) => Contrato = (c) => c) {
  const raiz = copia(repo);
  const contrato = transformar(contratoDe(raiz));
  const hecho = aplicar(raiz, contrato.huella, archivosCli(contrato));
  return { raiz, contrato, hecho, cli: corredor(raiz, contrato) };
}

/** La huella del dominio calculada aquí, como la describe el contrato: así se comprueba que el CLI hace lo que dice. */
function huellaEsperada(raiz: string, contrato: Contrato): string {
  const pares = contrato.dominio.fuentes.map((f) => {
    let datos: Buffer | null;
    try {
      datos = readFileSync(join(raiz, f.ruta));
    } catch {
      datos = null;
    }
    return [f.ruta, datos === null ? null : createHash("sha256").update(datos).digest("hex")];
  });
  return sha256(jsonCanonico(pares));
}

const tokens = (json: unknown) => Math.round(JSON.stringify(json).length / 4);
const HAY_PYTHON = spawnSync("python3", ["--version"]).status === 0;
const sinPython = HAY_PYTHON ? false : "python3 no está en esta máquina";

// --- el contrato que usa el generador ---

test("el contrato dice qué hace cada verbo sobre el dominio y cómo se calcula la huella", () => {
  const nodeCli = contratoDe(join(REPOS, "node-cli"));
  assert.deepEqual(nodeCli.dominio.fuentes, [
    { ruta: "data/bitacora.jsonl", formato: "jsonl", bitacora: true },
    { ruta: "data/estado.json", formato: "json", bitacora: false },
  ]);
  assert.match(nodeCli.dominio.huella, /sha256/);
  assert.deepEqual(Object.fromEntries(nodeCli.verbos.map((v) => [v.nombre, v.implementacion])), {
    estado: { tipo: "resumen" },
    listar: { tipo: "listar", coleccion: "data/estado.json", filtros: ["estado"] },
    entregar: { tipo: "anexar", destino: "data/bitacora.jsonl", evento: "entregar", campos: ["id", "evidencia"], existe: { entrada: "id", coleccion: "data/estado.json", campo: "id" } },
  });
  const pythonCli = contratoDe(join(REPOS, "python-cli"));
  const sinImplementar = pythonCli.verbos.filter((v) => v.implementacion.tipo === "sin-implementar");
  assert.deepEqual(sinImplementar.map((v) => v.nombre), ["entregar", "buscar", "leer-tarea"]);
  for (const v of sinImplementar) {
    assert.ok(v.errores.some((e) => e.codigo === 5 && !e.reintentable), `${v.nombre} declara el 5 que dará`);
    assert.ok(pythonCli.notas.some((n) => n.includes(`«${v.nombre}»`)), `${v.nombre} queda en las notas`);
  }
  assert.equal(pythonCli.verbos.find((v) => v.nombre === "listar-tareas")!.implementacion.tipo, "listar");
});

// --- el generador ---

test("genera el contrato, el CLI en contrato.cli.ruta y su README, todos con cabecera; Python cuando el contrato lo pide", () => {
  const node = preparar("node-cli");
  assert.deepEqual(node.hecho.escritos.map((e) => e.ruta), ["ax/contrato.json", "ax/cli.mjs", "ax/cli.md"]);
  for (const e of node.hecho.escritos) assert.deepEqual(leerCabecera(readFileSync(join(node.raiz, e.ruta), "utf8")), { contrato: node.contrato.huella, intacto: true });
  const python = archivosCli(contratoDe(join(REPOS, "python-cli")));
  assert.deepEqual(python.map((a) => a.ruta), ["ax/contrato.json", "ax/cli.py", "ax/cli.md"]);
  assert.equal(python[1]!.comentario, "#");
  const leeme = readFileSync(join(node.raiz, "ax/cli.md"), "utf8");
  assert.match(leeme, /pendiente-a-hecha/);
  assert.match(archivosCli(contratoDe(join(REPOS, "python-cli")))[2]!.contenido, /Lo que no se pudo implementar[\s\S]*`buscar`/);
});

test("lo generado no tiene dependencias: solo node:* en Node y la biblioteca estándar en Python", () => {
  const contrato = contratoDe(join(REPOS, "node-cli"));
  const js = archivosCli(contrato)[1]!.contenido;
  const desde = [...js.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!);
  assert.ok(desde.length > 0 && desde.every((m) => m.startsWith("node:")), desde.join(", "));
  assert.doesNotMatch(js, /require\(|import\(/);
  const py = archivosCli(enPython(contrato))[1]!.contenido;
  const modulos = [...py.matchAll(/^(?:import|from) (\w+)/gm)].map((m) => m[1]!);
  assert.deepEqual([...new Set(modulos)].sort(), ["csv", "datetime", "hashlib", "io", "json", "os", "re", "sys"]);
});

test("archivosCli se niega con 5 si el contrato no tiene verbos", () => {
  const contrato = contratoDe(join(REPOS, "node-cli"));
  assert.throws(() => archivosCli({ ...contrato, verbos: [] }), (e: unknown) => e instanceof ErrorAx && e.codigo === 5);
});

// --- el CLI generado, ejecutado: lo mismo en Node y en Python ---

for (const [lenguaje, transformar, skip] of [["node", (c: Contrato) => c, false], ["python", enPython, sinPython]] as const) {
  test(`${lenguaje}: la lectura resumen lee el estado real, dentro de su presupuesto, con la huella del dominio`, { skip }, () => {
    const { raiz, contrato, cli } = preparar("node-cli", transformar);
    const { codigo, json } = cli("estado");
    assert.equal(codigo, 0);
    assert.equal(json["esquema"], 1);
    assert.equal(json["huella"], huellaEsperada(raiz, contrato));
    const [bitacora, estado] = json["fuentes"];
    assert.deepEqual([bitacora.ruta, bitacora.registros, bitacora.ultimos.at(-1).evento], ["data/bitacora.jsonl", 2, "aprobar"]);
    assert.deepEqual([estado.ruta, estado.colecciones, estado.ids], ["data/estado.json", { tareas: 1 }, ["t-1"]]);
    assert.ok(tokens(json) <= json["presupuesto_tokens"]);
    assert.equal(json["presupuesto_tokens"], contrato.lecturas.find((l) => l.verbo === "estado")!.presupuesto_tokens);
  });

  test(`${lenguaje}: listar devuelve los registros de la colección, filtra por sus entradas y recorta al presupuesto`, { skip }, () => {
    const { raiz, cli } = preparar("node-cli", transformar);
    assert.deepEqual(cli("listar").json["registros"], [{ id: "t-1", titulo: "Medir" }]);
    const tareas = Array.from({ length: 400 }, (_, i) => ({ id: `t-${i}`, titulo: `Tarea número ${i} con un título largo de verdad`, estado: i % 2 ? "hecha" : "pendiente" }));
    writeFileSync(join(raiz, "data/estado.json"), JSON.stringify({ esquema: 1, tareas }));
    const filtrada = cli("listar", "--estado=pendiente").json;
    assert.equal(filtrada["total"], 200);
    assert.ok(filtrada["registros"].every((r: { estado: string }) => r.estado === "pendiente"));
    assert.equal(filtrada["truncado"], true);
    assert.ok(filtrada["mostrados"] < 200 && filtrada["mostrados"] > 0);
    assert.ok(tokens(filtrada) <= 2000, `listar ocupó ${tokens(filtrada)} tokens`);
    assert.match(filtrada["salida"], /acota/);
    const resumen = cli("estado").json;
    assert.ok(tokens(resumen) <= 500, `el resumen ocupó ${tokens(resumen)} tokens`);
  });

  test(`${lenguaje}: una escritura es un ensayo que no toca nada; con --aplicar y la huella escribe y devuelve el estado nuevo`, { skip }, () => {
    const { raiz, contrato, cli } = preparar("node-cli", transformar);
    const bitacora = join(raiz, "data/bitacora.jsonl");
    const antes = readFileSync(bitacora, "utf8");
    const huella = cli("estado").json["huella"];
    const ensayo = cli("entregar", "t-1", "--evidencia=npm test: 9/9");
    assert.equal(ensayo.codigo, 0);
    assert.equal(ensayo.json["ensayo"], true);
    assert.deepEqual(ensayo.json["cambios"].map((c: { ruta: string; accion: string }) => [c.ruta, c.accion]), [["data/bitacora.jsonl", "anexar"]]);
    assert.equal(ensayo.json["estado_nuevo"], null);
    assert.equal(ensayo.json["huella"], huella);
    assert.deepEqual(ensayo.json["para_aplicar"], ["entregar", "t-1", "--evidencia=npm test: 9/9", "--aplicar", `--huella=${huella}`]);
    assert.equal(readFileSync(bitacora, "utf8"), antes, "el ensayo no escribió");

    const hecho = cli(...ensayo.json["para_aplicar"]);
    assert.equal(hecho.codigo, 0);
    assert.equal(hecho.json["ensayo"], false);
    assert.equal(hecho.json["huella_anterior"], huella);
    assert.equal(hecho.json["huella"], huellaEsperada(raiz, contrato));
    assert.equal(hecho.json["huella"], cli("estado").json["huella"], "la huella nueva es la que da la lectura");
    const ultima = JSON.parse(readFileSync(bitacora, "utf8").trim().split("\n").at(-1)!);
    assert.deepEqual({ ...ultima, fecha: "x" }, { evento: "entregar", id: "t-1", evidencia: "npm test: 9/9", fecha: "x" });
    assert.ok(readFileSync(bitacora, "utf8").startsWith(antes), "anexa, no reescribe lo anterior");
    assert.equal(hecho.json["estado_nuevo"]["fuentes"][0]["registros"], 3);

    const otraVez = cli("entregar", "t-1", "--evidencia=npm test: 9/9", "--aplicar");
    assert.equal(otraVez.codigo, 0);
    assert.equal(otraVez.json["sin_cambios"], true, "repetir la misma escritura no cambia nada");
    assert.equal(readFileSync(bitacora, "utf8").trim().split("\n").length, 3);
  });

  test(`${lenguaje}: con una huella vieja sale con 4 y no escribe, también en el ensayo`, { skip }, () => {
    const { raiz, cli } = preparar("node-cli", transformar);
    const huella = cli("estado").json["huella"];
    writeFileSync(join(raiz, "data/estado.json"), JSON.stringify({ esquema: 1, tareas: [{ id: "t-1" }, { id: "t-2" }] }));
    const antes = readFileSync(join(raiz, "data/bitacora.jsonl"), "utf8");
    for (const extra of [[], ["--aplicar"]]) {
      const r = cli("entregar", "t-1", "--evidencia=ok", `--huella=${huella}`, ...extra);
      assert.equal(r.codigo, 4);
      assert.equal(r.json["reintentable"], true);
      assert.match(r.json["salida"], /Vuelve a leer con «.* estado»/);
      assert.match(r.json["huella_actual"], /^[0-9a-f]{64}$/);
    }
    assert.equal(readFileSync(join(raiz, "data/bitacora.jsonl"), "utf8"), antes);
  });

  test(`${lenguaje}: una transición vedada no es verbo y sale con 5 diciendo que es de una persona`, { skip }, () => {
    const { contrato, cli } = preparar("node-cli", transformar);
    for (const vedada of contrato.vedadas) {
      const r = cli(vedada.nombre);
      assert.equal(r.codigo, 5, vedada.nombre);
      assert.match(r.json["error"], /vedada/);
      assert.match(r.json["salida"], /persona/);
      assert.equal(r.json["reintentable"], false);
    }
    const ayuda = cli("--help").json;
    assert.deepEqual(ayuda["verbos"].map((v: { nombre: string }) => v.nombre), ["estado", "listar", "entregar"]);
    assert.deepEqual(ayuda["vedadas"], ["pendiente-a-hecha", "editar-el-estado-a-mano"]);
  });

  test(`${lenguaje}: los errores de uso salen con 2, con error, salida y reintentable, sin tocar nada`, { skip }, () => {
    const { raiz, cli } = preparar("node-cli", transformar);
    const antes = readFileSync(join(raiz, "data/bitacora.jsonl"), "utf8");
    const casos: string[][] = [
      [], ["volar"], ["entregar", "t-1"], ["entregar", "--evidencia=ok"], ["entregar", "t-1", "--evidencia", "ok"],
      ["entregar", "t-1", "--evidencia=ok", "--aplicar=true"], ["entregar", "t-1", "t-2", "--evidencia=ok"], ["entregar", "-x", "--evidencia=ok"],
      ["listar", "--aplicar"], ["estado", "--nada=1"], ["entregar", "t-9", "--evidencia=ok"], ["entregar", "t-1", "--evidencia="],
    ];
    for (const argumentos of casos) {
      const r = cli(...argumentos);
      assert.equal(r.codigo, 2, argumentos.join(" "));
      assert.equal(r.json["esquema"], 1);
      assert.ok(typeof r.json["error"] === "string" && r.json["error"] !== "");
      assert.ok(typeof r.json["salida"] === "string" && r.json["salida"] !== "");
      assert.equal(r.json["reintentable"], false);
    }
    assert.equal(readFileSync(join(raiz, "data/bitacora.jsonl"), "utf8"), antes);
  });

  test(`${lenguaje}: un dominio ilegible es un 3 en la escritura y un error por fuente en el resumen`, { skip }, () => {
    const { raiz, cli } = preparar("node-cli", transformar);
    writeFileSync(join(raiz, "data/bitacora.jsonl"), '{"evento":"a"}\nesto no es json\n');
    const r = cli("entregar", "t-1", "--evidencia=ok", "--aplicar");
    assert.equal(r.codigo, 3);
    assert.match(r.json["error"], /línea 2/);
    const resumen = cli("estado");
    assert.equal(resumen.codigo, 0);
    assert.match(resumen.json["fuentes"][0]["error"], /línea 2/);
  });
}

test("node y python dan la misma huella y el mismo resumen sobre el mismo dominio", { skip: sinPython }, () => {
  const raiz = copia("node-cli");
  const contrato = contratoDe(raiz);
  aplicar(raiz, contrato.huella, archivosCli(contrato));
  const python = enPython(contrato);
  aplicar(raiz, python.huella, archivosCli(python).filter((a) => a.ruta === "ax/cli.py"));
  const deNode = corredor(raiz, contrato)("estado").json;
  const dePython = corredor(raiz, python)("estado").json;
  assert.deepEqual(dePython, deNode);
  assert.deepEqual(corredor(raiz, python)("listar").json, corredor(raiz, contrato)("listar").json);
});

// --- los otros repos de mentira ---

test("python-cli: las lecturas con colección funcionan y los verbos sin implementar salen con 5 y dicen qué falta", { skip: sinPython }, () => {
  const { contrato, cli } = preparar("python-cli");
  assert.equal(contrato.cli.ruta, "ax/cli.py");
  const estado = cli("estado").json;
  assert.deepEqual(estado["fuentes"].map((f: { ruta: string }) => f.ruta), ["estado.yaml", "tareas.csv"]);
  assert.deepEqual(estado["fuentes"][0]["claves"], ["version", "tareas"]);
  assert.deepEqual(cli("listar-tareas").json["registros"], [{ id: "t-1", titulo: "Uno" }, { id: "t-2", titulo: "Dos" }]);
  for (const [verbo, ...args] of [["entregar", "--evidencia=x"], ["buscar"], ["leer-tarea"]] as [string, ...string[]][]) {
    const r = cli(verbo, ...args);
    assert.equal(r.codigo, 5, verbo);
    assert.match(r.json["error"], /no está implementado/);
    assert.match(r.json["salida"], /axd generar cli/);
    assert.equal(r.json["reintentable"], false);
  }
});

test("muy-malo: «aprobar» es vedada y «cambiar» sale con 5 porque el contrato no dice qué cambia", () => {
  const { raiz, cli } = preparar("muy-malo");
  const antes = readFileSync(join(raiz, "datos.json"), "utf8");
  assert.equal(cli("estado").json["fuentes"][0]["claves"][0], "x");
  const aprobar = cli("aprobar");
  assert.equal(aprobar.codigo, 5);
  assert.match(aprobar.json["error"], /vedada/);
  const cambiar = cli("cambiar", "--aplicar");
  assert.equal(cambiar.codigo, 5);
  assert.match(cambiar.json["salida"], /bitácora JSONL/);
  assert.equal(readFileSync(join(raiz, "datos.json"), "utf8"), antes);
});

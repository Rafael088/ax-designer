// El contrato contra los repos de mentira (pruebas/repos/): Informe + Inventario → Contrato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { analizar, lectorDeDisco, lectorEnMemoria, type Lector } from "../../src/analizador/index.ts";
import { generarContrato, huellaDe } from "../../src/contrato/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import type { Contrato } from "../../src/modelo/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";

const REPOS = join(import.meta.dirname, "..", "repos");

function contratoDe(lector: Lector): Contrato {
  const inventario = analizar(lector);
  return generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
}

const nodeCli = contratoDe(lectorDeDisco(join(REPOS, "node-cli")));
const pythonCli = contratoDe(lectorDeDisco(join(REPOS, "python-cli")));
const muyMalo = contratoDe(lectorDeDisco(join(REPOS, "muy-malo")));

const verbo = (c: Contrato, nombre: string) => c.verbos.find((v) => v.nombre === nombre)!;

test("el contrato declara esquema 1, sobrevive a JSON y su huella es la de su cuerpo", () => {
  assert.equal(nodeCli.esquema, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(nodeCli)), nodeCli);
  assert.match(nodeCli.huella, /^[0-9a-f]{64}$/);
  assert.equal(huellaDe(nodeCli), nodeCli.huella);
});

test("la huella no depende de cómo se pidió la ruta, y sí de lo que dice el contrato", () => {
  const otraRuta = contratoDe(lectorDeDisco(relative(process.cwd(), join(REPOS, "node-cli")) || "."));
  assert.notEqual(otraRuta.raiz, nodeCli.raiz);
  assert.equal(otraRuta.huella, nodeCli.huella);
  assert.notEqual(huellaDe({ ...nodeCli, notas: [] }), nodeCli.huella);
});

test("node-cli: los verbos del CLI, unidos con sus tools de MCP y sus rutas HTTP", () => {
  assert.deepEqual(nodeCli.verbos.map((v) => [v.nombre, v.tipo, v.origen]), [
    ["estado", "lectura", "existente"],
    ["listar", "lectura", "existente"],
    ["entregar", "escritura", "existente"],
  ]);
  assert.deepEqual(verbo(nodeCli, "estado").visto_en.map((v) => v.via), ["cli", "mcp", "api"]);
  assert.deepEqual(verbo(nodeCli, "listar").entradas.map((e) => [e.nombre, e.como, e.bandera]), [["estado", "bandera", "--estado"]]);
});

test("un verbo de escritura: ensayo por defecto, huella, el id de su ruta y la evidencia que exige", () => {
  const entregar = verbo(nodeCli, "entregar");
  assert.equal(entregar.ensayo_por_defecto, true);
  assert.deepEqual(entregar.entradas.map((e) => [e.nombre, e.tipo, e.requerida, e.como]), [
    ["id", "texto", true, "posicional"],
    ["evidencia", "texto", true, "bandera"],
    ["aplicar", "booleano", false, "bandera"],
    ["huella", "texto", false, "bandera"],
  ]);
  assert.ok(!entregar.entradas.some((e) => e.bandera === "--dry-run"), "--dry-run lo reemplaza la convención de --aplicar");
  assert.deepEqual(entregar.evidencia, { exige: ["evidencia"], devuelve: ["cambios", "estado_nuevo", "huella"] });
  assert.deepEqual(entregar.errores.map((e) => [e.codigo, e.reintentable]), [[2, false], [3, false], [4, true], [5, false]]);
  assert.ok(entregar.errores.every((e) => e.salida.length > 0));
  assert.deepEqual(entregar.salida.claves, ["esquema", "ensayo", "cambios", "estado_nuevo", "huella"]);
});

test("las lecturas traen su presupuesto (umbrales de la rúbrica) y lo que cuesta hoy el camino caro", () => {
  assert.deepEqual(nodeCli.lecturas.map((l) => [l.verbo, l.presupuesto_tokens]), [["estado", 500], ["listar", 2000]]);
  const [estado] = nodeCli.lecturas;
  assert.deepEqual(estado!.fuente, ["data/bitacora.jsonl", "data/estado.json"]);
  assert.equal(estado!.tokens_camino_caro, Math.round((126 + 65) / 4));
});

test("vedadas: la tabla de dueños de AGENTS.md y editar el estado a mano, con su evidencia", () => {
  assert.deepEqual(nodeCli.vedadas.map((v) => [v.nombre, v.dueno]), [["pendiente-a-hecha", "persona"], ["editar-el-estado-a-mano", "persona"]]);
  assert.deepEqual(nodeCli.vedadas[0]!.evidencia, [{ archivo: "AGENTS.md", linea: 7 }]);
});

test("cómo se invoca el CLI: el que genera `axd generar cli`, con su convención de argv", () => {
  assert.deepEqual(
    { ...nodeCli.cli, convencion: undefined },
    {
      origen: "generado", generador: "axd generar cli", lenguaje: "javascript", ruta: "ax/cli.mjs", programa: "node",
      argumentos: ["ax/cli.mjs"], cwd: "raiz", salida: "json", banderas: { aplicar: "--aplicar", huella: "--huella" }, convencion: undefined,
    },
  );
  assert.match(nodeCli.cli.convencion, /--bandera=valor/);
  assert.equal(nodeCli.proyecto.nombre, "tareas");
  assert.deepEqual(Object.keys(nodeCli.codigos), ["0", "2", "3", "4", "5"]);
});

test("python-cli: CLI en Python, la lectura «estado» propuesta, y las rutas HTTP no añaden verbos", () => {
  assert.equal(pythonCli.cli.lenguaje, "python");
  assert.deepEqual([pythonCli.cli.programa, ...pythonCli.cli.argumentos], ["python3", "ax/cli.py"]);
  assert.deepEqual(pythonCli.verbos.map((v) => [v.nombre, v.origen]), [
    ["estado", "propuesto"], ["listar-tareas", "existente"], ["entregar", "existente"], ["buscar", "existente"], ["leer-tarea", "existente"],
  ]);
  assert.deepEqual(verbo(pythonCli, "estado").visto_en, []);
  assert.ok(pythonCli.notas.some((n) => /rutas HTTP/.test(n)));
});

test("muy-malo: «aprobar» no es verbo sino transición vedada, y el contrato dice qué hallazgos atiende", () => {
  assert.deepEqual(muyMalo.verbos.map((v) => v.nombre), ["estado", "cambiar"]);
  const aprobar = muyMalo.vedadas.find((v) => v.nombre === "aprobar")!;
  assert.deepEqual(aprobar.evidencia, [{ archivo: "src/cli.ts", linea: 5 }]);
  const criterios = muyMalo.atiende.map((a) => a.criterio);
  for (const c of ["verbos-estrechos/sin-autoaprobacion", "lectura-barata/resumen-existe", "escritura-verificada/ensayo-antes-de-escribir"]) {
    assert.ok(criterios.includes(c), `falta ${c} en atiende`);
  }
  assert.ok(muyMalo.atiende.every((a) => a.resultado === "parcial" || a.resultado === "no-cumple"));
});

test("un repo sin superficies ni estado da un contrato sin verbos que lo dice en sus notas", () => {
  const vacio = contratoDe(lectorEnMemoria({ "README.md": "# Nada\n" }));
  assert.deepEqual([vacio.verbos, vacio.lecturas, vacio.vedadas], [[], [], []]);
  assert.equal(vacio.proyecto.nombre, "repo");
  assert.ok(vacio.notas.some((n) => /No hay verbos/.test(n)));
});

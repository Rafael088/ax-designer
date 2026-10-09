// Las descripciones de los verbos HTTP salen del código del manejador: qué devuelve, de qué periodo,
// y el defecto y los topes de cada entrada. Nunca el genérico «Llama a GET …», y lo que no se vio
// se dice que no se pudo seguir en vez de inventarlo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { generarContrato } from "../../src/contrato/index.ts";
import { describirParametro, describirPeriodo, describirVerboHttp } from "../../src/contrato/descripciones.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { medir } from "../../src/medicion/index.ts";
import type { Contrato } from "../../src/modelo/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";

const REPOS = join(import.meta.dirname, "..", "repos");

function contratoDe(repo: string): Contrato {
  const inventario = analizar(lectorDeDisco(join(REPOS, repo)));
  return generarContrato(generarInforme(inventario.raiz, evaluarRubrica(inventario, medir(inventario))), inventario);
}

const panel = contratoDe("next-panel");
const verbo = (nombre: string) => panel.verbos.find((v) => v.nombre === nombre)!;
const entrada = (v: string, e: string) => verbo(v).entradas.find((x) => x.nombre === e)!;

test("ningún verbo HTTP de los repos de prueba tiene la descripción genérica «Llama a …»", () => {
  for (const repo of ["next-panel", "next-prisma", "next-pages"]) {
    for (const v of contratoDe(repo).verbos) {
      assert.doesNotMatch(v.descripcion, /^Llama a /, `${repo} ${v.nombre}: ${v.descripcion}`);
      assert.match(v.descripcion, v.tipo === "lectura" ? /No cambia nada\.$/ : /ensayo/, `${repo} ${v.nombre}`);
    }
  }
});

test("una lista: el modelo con sus columnas, su orden y cuántas trae con el defecto y el tope del parámetro", () => {
  assert.equal(
    verbo("listar-pedidos").descripcion,
    "Los últimos pedidos, del más reciente al más viejo. Lee GET /api/pedidos: devuelve una lista de Pedido (id, fecha, total; con items), " +
      "ordenada por fecha desc, como mucho «limite» (por defecto 30, máximo 200). No cambia nada.",
  );
  assert.equal(entrada("listar-pedidos", "limite").descripcion, "Parámetro de consulta «limite»: número; fija cuántos devuelve; por defecto 30; de 1 a 200 (src/app/api/pedidos/route.ts:14).");
  assert.match(verbo("listar-gastos").descripcion, /de los últimos «dias» días \(por defecto 30, máximo 365\)/);
  assert.match(entrada("listar-gastos", "dias").descripcion, /entero; fija el periodo: los últimos «dias» días; por defecto 30; de 1 a 365/);
  assert.match(entrada("listar-gastos", "categoria").descripcion, /filtra lo que devuelve/);
  assert.match(verbo("listar-productos").descripcion, /y a cada uno le añade orden, disponible/);
});

test("un resumen: cada clave con su periodo, y la consulta agrupada con su orden y su tope", () => {
  const d = verbo("resumen").descripcion;
  assert.match(d, /^Lo que muestra la portada del panel, en una sola lectura\. Lee GET \/api\/resumen: devuelve un objeto con /);
  assert.match(d, /ventas \{hoy \(de hoy\), ayer \(de ayer\), semana \(de los últimos 7 días\)\}/);
  assert.match(d, /masVendidos \(de los últimos 30 días; PedidoItem agrupado por productoId, ordenada por cantidad desc, como mucho 5\)/);
  assert.match(d, /facturas \{vencidas \{cantidad, lista\}\}/);
  assert.match(verbo("resumen").salida.descripcion, /En «respuesta», un objeto con ventas/);
});

test("las entradas de consulta validadas con zod son requeridas si zod las exige, y dicen sus valores", () => {
  assert.equal(entrada("listar-buscar", "q").requerida, true);
  assert.equal(entrada("listar-buscar", "pagina").requerida, false);
  assert.match(entrada("listar-buscar", "q").descripcion, /texto; requerido; mínimo 2 caracteres/);
  assert.match(entrada("listar-buscar", "tipo").descripcion, /valores que entiende: «producto», «pedido»/);
  assert.match(verbo("listar-buscar").descripcion, /resultados \(lista de Producto, como mucho «tamano» \(por defecto 20, máximo 50\)\)/);
});

test("el cuerpo sale del zod que se le pasa a un ayudante (leerCuerpo(req, pedidoSchema)), con defectos, topes y valores", () => {
  const impl = verbo("crear-pedidos").implementacion;
  assert.equal(impl.tipo === "http" && impl.cuerpo?.forma?.nombre, "pedidoSchema");
  assert.match(entrada("crear-pedidos", "cuerpo").descripcion, /items \(lista, requerido, mínimo 1 elemento\(s\)\), nota \(texto, máximo 140 caracteres\), canal \(texto, por defecto «mesa», uno de «mesa», «domicilio»\)/);
  assert.match(verbo("crear-pedidos").descripcion, /^Hace POST \/api\/pedidos con el cuerpo de --cuerpo: devuelve el registro creado de Pedido \(id, fecha, total\)\. Sin aplicar/);
});

test("lo que no se pudo seguir se dice, no se inventa", () => {
  const ruta = { metodo: "get" as const, ruta: "/api/x", archivo: "src/app/api/x/route.ts", linea: 3 };
  assert.equal(describirVerboHttp(ruta, "GET", false, []), "Lee GET /api/x: no se pudo seguir qué devuelve (mira src/app/api/x/route.ts:3). No cambia nada.");
  assert.equal(describirParametro("q", { nombre: "q", linea: 4 }, ruta, ""), "El parámetro de consulta «q»; no se vio su valor por defecto ni sus topes (src/app/api/x/route.ts:4).");
});

test("describirPeriodo: hoy, ayer, los últimos N días, un tramo anterior y un parámetro", () => {
  const p = (desde: number, hasta: number | null) => describirPeriodo({ desde, hasta, expresion: "" });
  assert.equal(p(0, null), "de hoy");
  assert.equal(p(0, 1), "de hoy");
  assert.equal(p(-1, 0), "de ayer");
  assert.equal(p(-29, 1), "de los últimos 30 días");
  assert.equal(p(-13, -6), "de 7 días, de hace 13 a hace 7 días");
  assert.equal(describirPeriodo({ desde: 0, hasta: null, parametro: "dias", expresion: "" }), "de los últimos «dias» días");
});

// El contrato de un repo que solo expone rutas HTTP (Next.js): un verbo por método y ruta, con la
// implementación `http`, el cuerpo que se pudo inferir (zod, si no Prisma) y lo que no, en notas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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

const nextPrisma = contratoDe(lectorDeDisco(join(REPOS, "next-prisma")));
const nextPages = contratoDe(lectorDeDisco(join(REPOS, "next-pages")));
const verbo = (c: Contrato, nombre: string) => c.verbos.find((v) => v.nombre === nombre)!;
const llamada = (c: Contrato, nombre: string) => {
  const impl = verbo(c, nombre).implementacion;
  return impl.tipo === "http" ? `${impl.metodo} ${impl.ruta}` : impl.tipo;
};

test("next-prisma: un verbo por método y ruta, lectura por GET y escritura por POST/PATCH/DELETE", () => {
  assert.deepEqual(nextPrisma.verbos.map((v) => [v.nombre, v.tipo, llamada(nextPrisma, v.nombre)]), [
    ["crear-contacto", "escritura", "POST /api/contacto"],
    ["leer-docs", "lectura", "GET /api/docs/:ruta*"],
    ["crear-ordenes", "escritura", "POST /api/ordenes"],
    ["listar-productos", "lectura", "GET /api/productos"],
    ["crear-productos", "escritura", "POST /api/productos"],
    ["leer-productos", "lectura", "GET /api/productos/:id"],
    ["actualizar-productos", "escritura", "PATCH /api/productos/:id"],
    ["borrar-productos", "escritura", "DELETE /api/productos/:id"],
  ]);
  assert.ok(nextPrisma.verbos.every((v) => v.origen === "existente" && v.visto_en.every((x) => x.via === "api")));
  assert.ok(nextPrisma.verbos.every((v) => v.ensayo_por_defecto === (v.tipo === "escritura")));
  assert.equal(huellaDe(nextPrisma), nextPrisma.huella);
});

test("next-prisma: los parámetros de la ruta son posicionales, la consulta va en banderas y el cuerpo en --cuerpo", () => {
  const entradas = (n: string) => verbo(nextPrisma, n).entradas.map((e) => `${e.como === "posicional" ? `<${e.nombre}>` : e.bandera}${e.requerida ? "*" : ""}`);
  assert.deepEqual(entradas("leer-productos"), ["<id>*"]);
  assert.deepEqual(entradas("leer-docs"), ["<ruta>*"]);
  assert.deepEqual(entradas("listar-productos"), ["--categoria"]);
  assert.deepEqual(entradas("crear-productos"), ["--cuerpo*", "--aplicar"]);
  assert.deepEqual(entradas("actualizar-productos"), ["<id>*", "--cuerpo", "--aplicar"], "un PATCH parcial no exige cuerpo");
  assert.deepEqual(entradas("borrar-productos"), ["<id>*", "--aplicar"]);
  assert.ok(!nextPrisma.verbos.some((v) => v.entradas.some((e) => e.nombre === "huella")), "por HTTP no hay huella que comparar");
  const impl = verbo(nextPrisma, "leer-docs").implementacion;
  assert.deepEqual(impl.tipo === "http" && impl.parametros, [{ entrada: "ruta", segmento: "ruta", resto: true }]);
  const listar = verbo(nextPrisma, "listar-productos").implementacion;
  assert.deepEqual(listar.tipo === "http" && listar.consulta, [{ entrada: "categoria", parametro: "categoria" }]);
});

test("next-prisma: el cuerpo sale del esquema zod; sin él, del modelo de Prisma; sin ninguno, null y una nota", () => {
  const forma = (n: string) => {
    const impl = verbo(nextPrisma, n).implementacion;
    return impl.tipo === "http" ? impl.cuerpo?.forma : undefined;
  };
  assert.equal(forma("crear-productos")?.origen, "zod");
  assert.match(verbo(nextPrisma, "crear-productos").entradas[0]!.descripcion, /nombre \(texto, requerido\).*esquemaProducto.*route\.ts:6/);
  assert.deepEqual(forma("crear-ordenes"), {
    origen: "prisma",
    nombre: "Orden",
    desde: { archivo: "prisma/schema.prisma", linea: 28 },
    campos: [
      { nombre: "email", tipo: "texto", requerido: true },
      { nombre: "nota", tipo: "texto", requerido: false },
      { nombre: "estado", tipo: "texto", requerido: false },
      { nombre: "total", tipo: "numero", requerido: true },
    ],
  });
  assert.equal(forma("crear-contacto"), null);
  assert.equal(verbo(nextPrisma, "crear-contacto").entradas.find((e) => e.nombre === "cuerpo")?.requerida, false);
  assert.ok(nextPrisma.notas.some((n) => /No se pudo inferir el cuerpo de «crear-contacto»/.test(n)));
  assert.ok(nextPrisma.notas.some((n) => /«crear-ordenes».*modelo de Prisma «Orden»/.test(n)));
  assert.ok(nextPrisma.notas.some((n) => /base de datos \(modelos de Prisma en prisma\/schema\.prisma: Categoria, Producto, Orden\)/.test(n)));
});

test("next-prisma: el contrato dice dónde está el servidor; el esquema de Prisma no es una fuente que leer ni propone «estado»", () => {
  assert.deepEqual(nextPrisma.http, {
    base_url: { variable: "AX_BASE_URL", por_defecto: "http://localhost:3000", motivo: "el puerto de `next dev`" },
    espera_ms: { variable: "AX_HTTP_ESPERA_MS", por_defecto: 30000 },
  });
  assert.deepEqual(nextPrisma.dominio.fuentes, []);
  assert.ok(!nextPrisma.verbos.some((v) => v.nombre === "estado"));
  assert.deepEqual(nextPrisma.lecturas.map((l) => [l.verbo, l.fuente, l.tokens_camino_caro]), [
    ["leer-docs", [], null], ["listar-productos", [], null], ["leer-productos", [], null],
  ]);
  const escritura = verbo(nextPrisma, "crear-productos");
  assert.deepEqual(escritura.errores.map((e) => e.codigo).sort(), [2, 3, 4, 5]);
  assert.deepEqual(escritura.salida.claves, ["esquema", "ensayo", "peticion", "estado", "respuesta"]);
  assert.ok(!nextPrisma.atiende.some((a) => /huella/.test(a.como)), "no promete huella en escrituras HTTP");
});

test("next-pages: el Pages Router da los mismos verbos; sin req.method se toma como GET y queda en las notas", () => {
  assert.deepEqual(nextPages.verbos.map((v) => [v.nombre, llamada(nextPages, v.nombre)]), [
    ["listar-salud", "GET /api/salud"],
    ["listar-tareas", "GET /api/tareas"],
    ["crear-tareas", "POST /api/tareas"],
    ["leer-tareas", "GET /api/tareas/:id"],
    ["borrar-tareas", "DELETE /api/tareas/:id"],
  ]);
  assert.deepEqual(verbo(nextPages, "listar-tareas").entradas.map((e) => e.bandera), ["--estado"]);
  assert.ok(nextPages.notas.some((n) => /«listar-salud».*no compara req\.method.*GET/.test(n)));
});

test("nombres de rutas HTTP: acciones al final, resúmenes, PUT junto a PATCH, choques y cierres vedados", () => {
  const c = contratoDe(lectorEnMemoria({
    "package.json": JSON.stringify({ name: "x", dependencies: { express: "4" } }),
    "src/servidor.ts": [
      'app.get("/estado", f);',
      'app.post("/tareas/:id/entregar", f);',
      'app.post("/tareas/:id/aprobar", f);',
      'app.put("/tareas/:id", f);',
      'app.patch("/tareas/:id", f);',
      'app.get("/admin/tareas", f);',
      'app.get("/api/v1/tareas", f);',
    ].join("\n"),
  }));
  assert.deepEqual(c.verbos.map((v) => [v.nombre, llamada(c, v.nombre)]), [
    ["listar-admin-tareas", "GET /admin/tareas"],
    ["listar-tareas", "GET /api/v1/tareas"],
    ["estado", "GET /estado"],
    ["reemplazar-tareas", "PUT /tareas/:id"],
    ["actualizar-tareas", "PATCH /tareas/:id"],
    ["entregar", "POST /tareas/:id/entregar"],
  ]);
  assert.deepEqual(c.vedadas.map((v) => v.nombre), ["aprobar"], "aprobar sigue siendo de una persona");
  assert.equal(c.http?.base_url.por_defecto, "http://localhost:3000");
});

test("un repo con CLI sigue igual: las rutas HTTP solo completan y no hay bloque http", () => {
  const nodeCli = contratoDe(lectorDeDisco(join(REPOS, "node-cli")));
  assert.equal(nodeCli.http, undefined);
  assert.ok(nodeCli.verbos.every((v) => v.implementacion.tipo !== "http"));
});

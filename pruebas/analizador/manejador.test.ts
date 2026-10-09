// Lo que el analizador sigue dentro de un manejador HTTP: los parámetros de consulta por alias, con
// su valor por defecto y sus topes; lo que devuelve; y de qué periodo de fechas sale cada cosa.
// Contra el repo de mentira next-panel y textos sueltos, nunca contra un repo de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { documentacionDe, parametrosDeConsulta, respuestaDe } from "../../src/analizador/manejador.ts";
import { esquemasZod } from "../../src/analizador/next.ts";
import type { ParametroDeConsulta, RutaApi } from "../../src/modelo/index.ts";

const panel = analizar(lectorDeDisco(join(import.meta.dirname, "..", "repos", "next-panel")));
const ruta = (metodo: string, camino: string): RutaApi => panel.superficies.api.find((r) => r.metodo === metodo && r.ruta === camino)!;
const sinLinea = (ps: ParametroDeConsulta[] | undefined) => ps?.map(({ linea, ...resto }) => (void linea, resto));

test("alias: const p = new URL(req.url).searchParams; p.get(…), con su defecto (|| 30) y sus topes (Math.max/Math.min)", () => {
  const r = ruta("get", "/api/pedidos");
  assert.deepEqual(r.consulta, ["limite"]);
  assert.deepEqual(sinLinea(r.consulta_detalle), [{ nombre: "limite", tipo: "numero", por_defecto: 30, minimo: 1, maximo: 200, variable: "limite" }]);
  assert.equal(r.consulta_detalle![0]!.linea, 14);
});

test("alias desestructurado { searchParams: sp }, parseInt es entero, y lo que entra en el where filtra", () => {
  const r = ruta("get", "/api/gastos");
  assert.deepEqual(sinLinea(r.consulta_detalle), [
    { nombre: "categoria", variable: "categoria", filtra: true },
    { nombre: "dias", tipo: "entero", por_defecto: 30, minimo: 1, maximo: 365, variable: "dias", filtra: true },
  ]);
});

test("const { orden = \"nombre\", activos } = Object.fromEntries(searchParams): el defecto de la desestructuración y los valores comparados", () => {
  assert.deepEqual(sinLinea(ruta("get", "/api/productos").consulta_detalle), [
    { nombre: "activos", variable: "activos", valores: ["1"], filtra: true },
    { nombre: "orden", por_defecto: "nombre", variable: "orden" },
  ]);
});

test("zod sobre Object.fromEntries(new URL(req.url).searchParams): requerido, defectos, topes y enum de cada campo", () => {
  assert.deepEqual(sinLinea(ruta("get", "/api/buscar").consulta_detalle), [
    { nombre: "pagina", tipo: "entero", variable: "consulta.pagina", por_defecto: 1, minimo: 1 },
    { nombre: "q", tipo: "texto", requerido: true, variable: "consulta.q", minimo: 2 },
    { nombre: "tamano", tipo: "entero", variable: "consulta.tamano", por_defecto: 20, maximo: 50 },
    { nombre: "tipo", tipo: "texto", variable: "consulta.tipo", valores: ["producto", "pedido"] },
  ]);
  assert.equal(ruta("get", "/api/buscar").respuesta?.claves?.[0]?.consulta?.tope, "tamano", "take: consulta.tamano es el parámetro tamano");
});

test("Pages Router: const { formato = \"json\", limite = \"10\" } = req.query y el tope que se le pone después", () => {
  assert.deepEqual(sinLinea(ruta("all", "/api/reportes").consulta_detalle), [
    { nombre: "formato", por_defecto: "json", variable: "formato" },
    { nombre: "limite", por_defecto: "10", tipo: "numero", maximo: 100, variable: "n" },
  ]);
});

test("otras formas: req.nextUrl.searchParams, getAll, un get dentro de una condición y uno en un comentario que no cuenta", () => {
  const texto = [
    "export async function GET(req) {",
    "  const q = req.nextUrl.searchParams;",
    "  // q.get(\"fantasma\") no es una lectura",
    "  const etiquetas = q.getAll(\"etiqueta\");",
    "  if (q.get(\"orden\") === \"precio\") {}",
    "  const pagina = Number(q.get(\"pagina\") ?? 1);",
    "}",
  ].join("\n");
  const ps = parametrosDeConsulta(texto, "next-app-router", esquemasZod(texto));
  assert.deepEqual(ps.map((p) => p.nombre), ["etiqueta", "orden", "pagina"]);
  assert.deepEqual(ps.find((p) => p.nombre === "orden")!.valores, ["precio"]);
  assert.deepEqual({ ...ps.find((p) => p.nombre === "pagina")!, linea: 0 }, { nombre: "pagina", linea: 0, tipo: "numero", por_defecto: 1, variable: "pagina" });
});

test("respuesta: la lista de una consulta de Prisma con su orden, su tope por parámetro, lo que incluye y lo que añade a cada uno", () => {
  assert.deepEqual(ruta("get", "/api/pedidos").respuesta, {
    linea: 20, forma: "lista", consulta: { modelo: "pedido", operacion: "findMany", orden: ["fecha desc"], tope: "limite", incluye: ["items"] },
  });
  assert.deepEqual(ruta("get", "/api/gastos").respuesta?.periodo, { desde: 0, hasta: null, parametro: "dias", expresion: "inicioDelDia(-(dias - 1))" });
  assert.deepEqual(ruta("get", "/api/productos").respuesta?.anade, ["orden", "disponible"]);
  assert.deepEqual(ruta("post", "/api/pedidos").respuesta, { linea: 27, estado: 201, forma: "registro", consulta: { modelo: "pedido", operacion: "create" } });
});

test("respuesta de un resumen: cada clave con su periodo (hoy, ayer, 7 días, 30 días), la consulta agrupada y su tope; un `< hoy` no es un periodo", () => {
  const r = ruta("get", "/api/resumen").respuesta!;
  assert.equal(r.forma, "objeto");
  const ventas = r.claves!.find((k) => k.nombre === "ventas")!.claves!;
  assert.deepEqual(ventas.map((k) => [k.nombre, k.periodo?.desde, k.periodo?.hasta]), [["hoy", 0, null], ["ayer", -1, 0], ["semana", -6, null]]);
  const masVendidos = r.claves!.find((k) => k.nombre === "masVendidos")!;
  assert.equal(masVendidos.periodo?.desde, -29);
  assert.deepEqual(masVendidos.consulta, { modelo: "pedidoItem", operacion: "groupBy", agrupa: ["productoId"], orden: ["cantidad desc"], tope: 5 });
  const facturas = r.claves!.find((k) => k.nombre === "facturas")!;
  assert.deepEqual(facturas, { nombre: "facturas", claves: [{ nombre: "vencidas", claves: [{ nombre: "cantidad" }, { nombre: "lista" }] }] });
  assert.equal(ruta("get", "/api/resumen").doc, "Lo que muestra la portada del panel, en una sola lectura.");
});

test("respuesta: las de error (status ≥ 400 o { error }) no cuentan; subDays y Date.now() − N días también son periodos; sin respuesta, nada", () => {
  const texto = [
    "export async function GET(req) {",
    "  const desde = subDays(new Date(), 7);",
    "  const viejos = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);",
    "  if (!req) return NextResponse.json({ error: \"no\" }, { status: 400 });",
    "  const filas = await prisma.evento.findMany({ where: { fecha: { gte: desde } }, take: 50 });",
    "  const archivados = await prisma.evento.count({ where: { fecha: { lt: viejos } } });",
    "  return NextResponse.json({ filas, archivados });",
    "}",
  ].join("\n");
  const r = respuestaDe(texto, 1, texto, [])!;
  assert.equal(r.linea, 7);
  assert.deepEqual(r.claves!.map((k) => [k.nombre, k.periodo?.desde ?? null, k.consulta?.tope ?? null]), [["filas", -6, 50], ["archivados", null, null]]);
  assert.equal(respuestaDe("export function GET() {\n  return fallo(\"x\", 500);\n}", 1, "", []), undefined);
});

test("documentacionDe: el JSDoc o los // justo encima; nada si hay una línea en blanco", () => {
  assert.equal(documentacionDe(["/**", " * Marca una factura.", " * @param id el id", " */", "export async function PATCH() {}"], 5), "Marca una factura.");
  assert.equal(documentacionDe(["// Lista lo de hoy", "// y lo de ayer.", "export async function GET() {}"], 3), "Lista lo de hoy y lo de ayer.");
  assert.equal(documentacionDe(["// suelto", "", "export async function GET() {}"], 3), undefined);
});

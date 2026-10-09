// Next.js en el analizador: las rutas del App Router y del Pages Router como superficies HTTP, y
// los modelos de Prisma como estado del dominio. Contra los repos de mentira, nunca uno de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco, lectorEnMemoria } from "../../src/analizador/index.ts";
import { esquemasZod, rutasNext } from "../../src/analizador/next.ts";
import { modelosPrisma } from "../../src/analizador/prisma.ts";

const REPOS = join(import.meta.dirname, "..", "repos");
const nextPrisma = analizar(lectorDeDisco(join(REPOS, "next-prisma")));
const nextPages = analizar(lectorDeDisco(join(REPOS, "next-pages")));

const rutas = (inventario: typeof nextPrisma) => inventario.superficies.api.map((r) => `${r.metodo} ${r.ruta}`).sort();

test("App Router: un método por export, [id] como parámetro, [...x] como resto, sin grupos (x) ni carpetas _privadas", () => {
  assert.deepEqual(rutas(nextPrisma), [
    "delete /api/productos/:id",
    "get /api/docs/:ruta*",
    "get /api/productos",
    "get /api/productos/:id",
    "patch /api/productos/:id",
    "post /api/contacto",
    "post /api/ordenes",
    "post /api/productos",
  ]);
  assert.ok(nextPrisma.superficies.api.every((r) => r.marco === "next-app-router"));
  const ordenes = nextPrisma.superficies.api.find((r) => r.ruta === "/api/ordenes")!;
  assert.equal(ordenes.archivo, "src/app/(tienda)/api/ordenes/route.ts", "el grupo (tienda) está en el archivo, no en la ruta");
  assert.ok(!nextPrisma.superficies.api.some((r) => r.archivo.includes("_privado")));
});

test("App Router: la línea de cada método es la de su export, sea función, const o `export { f as DELETE }`", () => {
  const de = (metodo: string, ruta: string) => nextPrisma.superficies.api.find((r) => r.metodo === metodo && r.ruta === ruta)!;
  assert.equal(de("get", "/api/productos/:id").linea, 11);
  assert.equal(de("patch", "/api/productos/:id").linea, 18);
  assert.equal(de("delete", "/api/productos/:id").linea, 31);
});

test("App Router: los parámetros de consulta del GET y el cuerpo del esquema zod que valida cada manejador", () => {
  const listar = nextPrisma.superficies.api.find((r) => r.metodo === "get" && r.ruta === "/api/productos")!;
  assert.deepEqual(listar.consulta, ["categoria"]);
  const crear = nextPrisma.superficies.api.find((r) => r.metodo === "post" && r.ruta === "/api/productos")!;
  assert.equal(crear.cuerpo?.origen, "zod");
  assert.equal(crear.cuerpo?.nombre, "esquemaProducto");
  assert.deepEqual(crear.cuerpo?.desde, { archivo: "src/app/api/productos/route.ts", linea: 6 });
  assert.deepEqual(crear.cuerpo?.campos, [
    { nombre: "nombre", tipo: "texto", requerido: true },
    { nombre: "precio", tipo: "numero", requerido: true },
    { nombre: "stock", tipo: "entero", requerido: false },
    { nombre: "etiquetas", tipo: "lista", requerido: true },
    { nombre: "categoriaId", tipo: "entero", requerido: true },
  ]);
  const parche = nextPrisma.superficies.api.find((r) => r.metodo === "patch")!;
  assert.ok(parche.cuerpo!.campos.every((c) => !c.requerido), "un esquema .partial() no exige nada");
  assert.equal(nextPrisma.superficies.api.find((r) => r.ruta === "/api/ordenes")!.cuerpo, undefined, "sin zod no se inventa el cuerpo aquí");
});

test("Pages Router: los métodos salen de req.method (switch o comparación), el index no cuenta y sin método es «all»", () => {
  assert.deepEqual(rutas(nextPages), ["all /api/salud", "delete /api/tareas/:id", "get /api/tareas", "get /api/tareas/:id", "post /api/tareas"]);
  assert.ok(nextPages.superficies.api.every((r) => r.marco === "next-pages-router"));
  assert.deepEqual(nextPages.superficies.api.find((r) => r.metodo === "get" && r.ruta === "/api/tareas")!.consulta, ["estado"]);
  assert.equal(nextPages.superficies.api.find((r) => r.metodo === "get" && r.ruta === "/api/tareas/:id")!.consulta, undefined, "el id de la ruta no es consulta");
});

test("rutasNext: también app/ en la raíz, [[...x]] opcional, export const { GET, POST } y lo que no es ruta de Next", () => {
  const raiz = rutasNext("app/api/buscar/[[...filtros]]/route.js", "export const { GET, POST } = manejadores;\n");
  assert.deepEqual(raiz.map((r) => `${r.metodo} ${r.ruta}`), ["get /api/buscar/:filtros*?", "post /api/buscar/:filtros*?"]);
  assert.deepEqual(rutasNext("src/app/(admin)/@modal/api/x/route.ts", "export async function GET() {}\n").map((r) => r.ruta), ["/api/x"]);
  assert.deepEqual(rutasNext("src/app/page.tsx", "export async function GET() {}\n"), []);
  assert.deepEqual(rutasNext("src/lib/route.ts", "export async function GET() {}\n"), []);
  assert.deepEqual(rutasNext("pages/api/_utilidades.ts", "export default function f() {}\n"), []);
  assert.deepEqual(rutasNext("pages/api/index.ts", "export default function f() {}\n").map((r) => r.ruta), ["/api"]);
});

test("esquemasZod: campos de primer nivel, comentarios y comas dentro de llamadas no confunden", () => {
  const esquemas = esquemasZod([
    "const a = z.object({",
    "  // un comentario, con coma",
    "  nombre: z.string().min(2, { message: 'corto, muy corto' }),",
    "  'email': z.email().optional(),",
    "  items: z.array(z.object({ x: z.number().optional() })).min(1),",
    "  activo: z.boolean().default(true),",
    "  hijo: b,",
    "});",
  ].join("\n"));
  assert.deepEqual(esquemas.get("a")?.campos, [
    { nombre: "nombre", tipo: "texto", requerido: true },
    { nombre: "email", tipo: "texto", requerido: false },
    { nombre: "items", tipo: "lista", requerido: true },
    { nombre: "activo", tipo: "booleano", requerido: false },
    { nombre: "hijo", tipo: "otro", requerido: true },
  ]);
});

test("Prisma: los modelos de schema.prisma son estado del dominio, con sus campos, relaciones, enums y @@map", () => {
  const prisma = nextPrisma.estado.find((e) => e.formato === "prisma")!;
  assert.equal(prisma.ruta, "prisma/schema.prisma");
  assert.equal(prisma.rol, "dominio");
  assert.deepEqual(prisma.claves, ["Categoria", "Producto", "Orden"]);
  const producto = prisma.modelos!.find((m) => m.nombre === "Producto")!;
  assert.equal(producto.tabla, "productos");
  assert.deepEqual(producto.campos.map((c) => [c.nombre, c.tipo, c.id, c.por_defecto, c.relacion]), [
    ["id", "Int", true, true, false],
    ["nombre", "String", false, false, false],
    ["precio", "Float", false, false, false],
    ["stock", "Int", false, true, false],
    ["categoriaId", "Int", false, false, false],
    ["categoria", "Categoria", false, false, true],
    ["createdAt", "DateTime", false, true, false],
  ]);
  const orden = prisma.modelos!.find((m) => m.nombre === "Orden")!;
  assert.deepEqual(orden.campos.find((c) => c.nombre === "estado"), {
    nombre: "estado", tipo: "EstadoOrden", lista: false, opcional: false, por_defecto: true, id: false, relacion: false, enumerado: true, linea: 32,
  });
  assert.equal(orden.campos.find((c) => c.nombre === "nota")!.opcional, true);
  assert.ok(nextPrisma.buscado.estado.some((b) => b.includes(".prisma")));
});

test("Prisma: un esquema sin modelos no es estado, y uno bajo pruebas/ tampoco", () => {
  assert.deepEqual(modelosPrisma("datasource db {\n  provider = \"sqlite\"\n}\n"), []);
  const inventario = analizar(lectorEnMemoria({
    "prisma/schema.prisma": "datasource db {\n  provider = \"sqlite\"\n}\n",
    "pruebas/prisma/schema.prisma": "model X {\n  id Int @id\n}\n",
  }));
  assert.deepEqual(inventario.estado, []);
});

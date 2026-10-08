// Los patrones del código, caso por caso: qué cuenta como fallo silencioso y cómo se leen los imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerCodigo } from "../../src/analizador/codigo.ts";
import type { Lenguaje } from "../../src/modelo/index.ts";

function silenciosos(lenguaje: Lenguaje, codigo: string): number[] {
  const ruta = lenguaje === "python" ? "m.py" : "m.ts";
  return leerCodigo(ruta, lenguaje, codigo, new Set(), false).senales.filter((s) => s.tipo === "fallo-silencioso").map((s) => s.linea);
}

test("cuentan como fallo silencioso los catch vacíos o que solo devuelven un valor por defecto", () => {
  assert.deepEqual(silenciosos("typescript", "try { a() } catch {}"), [1]);
  assert.deepEqual(silenciosos("typescript", "try { a() } catch (e) { }"), [1]);
  assert.deepEqual(silenciosos("typescript", "try {\n  a();\n} catch (e) {\n  return null;\n}"), [3]);
  assert.deepEqual(silenciosos("typescript", "try {\n  a();\n} catch {\n  // da igual\n}"), [3]);
  assert.deepEqual(silenciosos("typescript", "p.catch(() => {});"), [1]);
  assert.deepEqual(silenciosos("python", "try:\n    a()\nexcept:\n    pass"), [3]);
  assert.deepEqual(silenciosos("python", "try:\n    a()\nexcept Exception:\n    return []"), [3]);
  assert.deepEqual(silenciosos("python", "try:\n    a()\nexcept KeyError: return None"), [3]);
});

test("no cuentan los que relanzan, avisan o hacen algo con el error", () => {
  assert.deepEqual(silenciosos("typescript", "try {\n  a();\n} catch (e) {\n  throw new ErrorAx(e);\n}"), []);
  assert.deepEqual(silenciosos("typescript", "try {\n  a();\n} catch (e) {\n  console.error(e);\n  return null;\n}"), []);
  assert.deepEqual(silenciosos("typescript", "try { a() } catch (e) { log(e) }"), []);
  assert.deepEqual(silenciosos("python", "try:\n    a()\nexcept ValueError as e:\n    raise Otro() from e"), []);
});

test("los imports de TS/JS se leen en todas sus formas y los relativos se resuelven, también .js → .ts", () => {
  const existentes = new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d/index.ts"]);
  const codigo = 'import type { A } from "./a.ts";\nexport * from "./b.ts";\nconst c = await import("./c.js");\nimport "./d";\nconst fs = require("node:fs");\n';
  const { modulo } = leerCodigo("src/m.ts", "typescript", codigo, existentes, false);
  assert.deepEqual(modulo.imports, ["./a.ts", "./b.ts", "./c.js", "./d", "node:fs"]);
  assert.deepEqual(modulo.imports_locales, ["src/a.ts", "src/b.ts", "src/c.ts", "src/d/index.ts"]);
  assert.equal(modulo.lineas, 5);
});

test("el switch solo da verbos en puntos de entrada o carpetas de CLI, para no confundir cualquier switch con una CLI", () => {
  const codigo = 'switch (x) {\n  case "rojo":\n    break;\n}';
  assert.deepEqual(leerCodigo("src/colores.ts", "typescript", codigo, new Set(), false).verbos, []);
  assert.deepEqual(leerCodigo("src/colores.ts", "typescript", codigo, new Set(), true).verbos.map((v) => v.nombre), ["rojo"]);
  assert.deepEqual(leerCodigo("src/cli/main.ts", "typescript", codigo, new Set(), false).verbos.map((v) => v.nombre), ["rojo"]);
});

// Hallazgo al auditar axd contra sí mismo: `axd auditar .` contaba `case "resumen":`,
// `case "listar":`, `case "leer":`… de `src/generadores/cli/index.ts` como si fueran verbos
// propios de axd — ese switch enumera tipos de `Implementacion` (qué generaría axd para el repo
// objetivo), no comandos de axd. Una ruta con /cli/ o /bin/ bajo generadores/ o plantillas/ no
// activa el switch solo por la ruta; esEntrada o un shebang de verdad sí siguen contando.
test("una carpeta de generador o plantilla no activa el switch solo por tener /cli/ o /bin/ en la ruta", () => {
  const codigo = 'function queHace(impl) {\n  switch (impl.tipo) {\n    case "resumen":\n      return "...";\n    case "listar":\n      return "...";\n  }\n}';
  assert.deepEqual(leerCodigo("src/generadores/cli/index.ts", "typescript", codigo, new Set(), false).verbos, []);
  assert.deepEqual(leerCodigo("src/generadores/cli/plantillas/node.ts", "typescript", codigo, new Set(), false).verbos, []);
  assert.deepEqual(leerCodigo("plantillas/bin/texto.ts", "typescript", codigo, new Set(), false).verbos, []);
  // Pero si de verdad es un punto de entrada (esEntrada o shebang), sigue contando igual.
  assert.deepEqual(leerCodigo("src/generadores/cli/index.ts", "typescript", codigo, new Set(), true).verbos.map((v) => v.nombre), ["resumen", "listar"]);
});

test("un import de interfaz o de servidor web es señal; uno de la biblioteca estándar no", () => {
  const { senales } = leerCodigo("app.py", "python", "import json\nfrom gi.repository import Gtk\nimport tkinter\n", new Set(), false);
  assert.deepEqual(senales.filter((s) => s.tipo === "importa-interfaz").map((s) => s.linea), [2, 3]);
});

// Hallazgo al auditar axd contra sí mismo: `add_parser(` con `help=` largo queda
// envuelto a dos líneas (así lo deja black) y el nombre entre comillas cae en la siguiente. La
// regla de una sola línea dejaba esos verbos (`buscar`, `leer` en tareas/conocimiento.py) fuera
// de superficies.cli, con lo que contexto-progresivo no veía ni la lista ni el detalle.
test("add_parser en una sola línea y envuelto a dos (el nombre en la siguiente) dan el mismo verbo", () => {
  const unaLinea = 'sub.add_parser("buscar", help="Una línea por entrada")';
  assert.deepEqual(leerCodigo("cli.py", "python", unaLinea, new Set(), true).verbos.map((v) => v.nombre), ["buscar"]);

  const envuelto = 'buscar = sub.add_parser(\n    "buscar", help="Una línea por entrada del almacén; barato")\nleer = sub.add_parser(\n    "leer", help="La entrada completa, por id")\n';
  const verbos = leerCodigo("cli.py", "python", envuelto, new Set(), true).verbos;
  assert.deepEqual(verbos.map((v) => v.nombre), ["buscar", "leer"]);
  assert.deepEqual(verbos.map((v) => v.linea), [1, 3], "la línea evidenciada es la del add_parser(, no la del nombre");
});

test("dos add_parser seguidos, cada uno en su propia línea, no se duplican ni se cruzan", () => {
  const codigo = 'sub.add_parser("a", help="x")\nsub.add_parser("b", help="y")\n';
  const verbos = leerCodigo("cli.py", "python", codigo, new Set(), true).verbos;
  assert.deepEqual(verbos.map((v) => v.nombre), ["a", "b"]);
  assert.deepEqual(verbos.map((v) => v.linea), [1, 2]);
});

// Hallazgo de axd sobre sí mismo: el case solo despacha
// (`return conErrores(() => verboGenerar(resto))`) y lo que el verbo devuelve vive en una función
// más abajo, lejos de la ventana de 20 líneas. El verbo de switch lleva su manejador.
test("un verbo de switch apunta a la función local a la que despacha, de su inicio a su }", () => {
  const relleno = Array.from({ length: 25 }, (_, i) => `// relleno ${i}`).join("\n");
  const codigo = [
    "#!/usr/bin/env node",
    "function main(argv) {",
    "  switch (argv[0]) {",
    '    case "generar":',
    "      return conErrores(() => verboGenerar(argv));",
    '    case "ver": return verboVer();',
    '    case "suelto":',
    "      break;",
    '    case "ajeno":',
    "      return fs.readFileSync(argv[1]);",
    "  }",
    "}",
    relleno,
    "function conErrores(f) {",
    "  return f();",
    "}",
    "function verboGenerar(argv) {",
    "  if (argv) {",
    "    return 1;",
    "  }",
    "  return { esquema: 1, salida: \"hecho\" };",
    "}",
    "const verboVer = () => {",
    "  return 2;",
    "};",
  ].join("\n");
  const verbos = leerCodigo("bin/cli.ts", "typescript", codigo, new Set(), true).verbos;
  const lineas = codigo.split("\n");
  const de = (nombre: string) => verbos.find((v) => v.nombre === nombre)!.manejador;
  const generar = de("generar")!;
  assert.equal(lineas[generar.linea - 1], "function verboGenerar(argv) {");
  assert.equal(lineas[generar.hasta - 1], "}");
  assert.equal(generar.hasta - generar.linea, 5);
  const ver = de("ver")!;
  assert.equal(lineas[ver.linea - 1], "const verboVer = () => {");
  assert.equal(lineas[ver.hasta - 1], "};");
  assert.equal(de("suelto"), undefined, "un case sin llamada no tiene manejador");
  assert.equal(de("ajeno"), undefined, "una llamada sin definición en el archivo no es manejador");
});

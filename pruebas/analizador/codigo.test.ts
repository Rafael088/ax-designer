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

test("un import de interfaz o de servidor web es señal; uno de la biblioteca estándar no", () => {
  const { senales } = leerCodigo("app.py", "python", "import json\nfrom gi.repository import Gtk\nimport tkinter\n", new Set(), false);
  assert.deepEqual(senales.filter((s) => s.tipo === "importa-interfaz").map((s) => s.linea), [2, 3]);
});

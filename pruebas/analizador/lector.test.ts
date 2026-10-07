import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { lectorDeDisco, lectorEnMemoria } from "../../src/analizador/lector.ts";
import { ErrorAx } from "../../src/modelo/index.ts";

test("el lector en memoria lista carpetas y archivos en orden y lee el contenido", () => {
  const lector = lectorEnMemoria({ "b.md": "hola", "a/x.ts": "", "a/y/z.ts": "" });
  assert.deepEqual(lector.listar(""), [{ nombre: "a", tipo: "carpeta", bytes: 0 }, { nombre: "b.md", tipo: "archivo", bytes: 4 }]);
  assert.deepEqual(lector.listar("a").map((e) => e.nombre), ["x.ts", "y"]);
  assert.equal(lector.leer("b.md"), "hola");
});

test("el lector de disco se niega con un ErrorAx de uso si la ruta no existe o no es carpeta", () => {
  const repos = join(import.meta.dirname, "..", "repos");
  for (const ruta of [join(repos, "no-existe"), join(repos, "node-cli", "package.json")]) {
    assert.throws(() => lectorDeDisco(ruta), (e: unknown) => e instanceof ErrorAx && e.codigo === 2 && e.salida.length > 0);
  }
});

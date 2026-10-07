// El archivo de tareas de prueba: el de ejemplo se lee, lo que falta toma el valor por defecto y
// cada error es uso incorrecto (2) que dice qué clave arreglar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorAx } from "../../src/modelo/index.ts";
import { leerTareas, POR_DEFECTO } from "../../src/validador/index.ts";
import { tareasDeNodeCli } from "./ayuda.ts";

function error(contenido: unknown): ErrorAx {
  try {
    leerTareas(typeof contenido === "string" ? contenido : JSON.stringify(contenido));
  } catch (e) {
    assert.ok(e instanceof ErrorAx, String(e));
    return e;
  }
  assert.fail("debía rechazar el archivo");
}

const MINIMA = { id: "una", enunciado: "Haz algo.", terminado: { tipo: "respuesta-contiene", texto: "hecho" } };

test("el archivo de ejemplo de node-cli se lee con sus dos tareas y sus criterios", () => {
  const t = tareasDeNodeCli();
  assert.equal(t.modelo, "sonnet");
  assert.equal(t.repeticiones, 1);
  assert.deepEqual(t.tareas.map((x) => [x.id, x.terminado.tipo]), [["titulo-de-t-1", "respuesta-contiene"], ["entregar-t-1", "comando"]]);
  assert.deepEqual(t.tareas[1]!.presupuesto, { rondas: 15, usd: 0.75, segundos: 600 });
});

test("lo que no dice el archivo toma el valor por defecto", () => {
  const t = leerTareas(JSON.stringify({ esquema: 1, tareas: [MINIMA] }));
  assert.equal(t.modelo, POR_DEFECTO.modelo);
  assert.equal(t.repeticiones, 1);
  assert.deepEqual(t.tareas[0]!.presupuesto, POR_DEFECTO.presupuesto);
});

test("cada error es un 2 que nombra la clave", () => {
  const casos: [unknown, RegExp][] = [
    ["{no es json", /no es JSON/],
    [{ esquema: 2, tareas: [MINIMA] }, /esquema/],
    [{ esquema: 1, tareas: [] }, /tareas/],
    [{ esquema: 1, tareas: [{ ...MINIMA, id: "Con Espacios" }] }, /tareas\[0\]\.id/],
    [{ esquema: 1, tareas: [MINIMA, MINIMA] }, /repetida/],
    [{ esquema: 1, tareas: [{ ...MINIMA, terminado: { tipo: "adivinar" } }] }, /terminado\.tipo/],
    [{ esquema: 1, tareas: [{ ...MINIMA, terminado: { tipo: "comando", argv: [] } }] }, /argv/],
    [{ esquema: 1, tareas: [{ ...MINIMA, terminado: { tipo: "archivo-contiene", ruta: "../fuera", texto: "x" } }] }, /no salir/],
    [{ esquema: 1, tareas: [{ ...MINIMA, presupuesto: { usd: -1 } }] }, /presupuesto\.usd/],
    [{ esquema: 1, repeticiones: 50, tareas: [MINIMA] }, /no puede pasar de 10/],
  ];
  for (const [contenido, mensaje] of casos) {
    const e = error(contenido);
    assert.equal(e.codigo, 2, e.message);
    assert.match(e.message, mensaje);
    assert.match(e.salida, /docs\/validador\.md/);
  }
});

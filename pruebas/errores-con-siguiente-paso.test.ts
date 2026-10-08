// Los fallos internos de axd también dicen qué hacer: son ErrorAx con `salida`, no un Error crudo
// que main.ts convertiría en un «Falló inesperadamente» sin siguiente paso concreto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conCabecera } from "../src/generadores/index.ts";
import { ErrorAx } from "../src/modelo/index.ts";
import { criterioJson, ejeJson, porMetrica } from "../src/rubrica/comun.ts";

function esErrorConSalida(e: unknown, mensaje: RegExp, salida: RegExp): true {
  assert.ok(e instanceof ErrorAx, "tiene que ser un ErrorAx, no un Error crudo");
  assert.equal(e.codigo, 3);
  assert.match(e.message, mensaje);
  assert.match(e.salida, salida);
  return true;
}

test("un eje que criterios.json no tiene dice qué archivo comparar", () => {
  assert.throws(() => ejeJson("no-existe"), (e) => esErrorConSalida(e, /no tiene el eje «no-existe»/, /criterios\.json/));
});

test("un criterio que criterios.json no tiene dice cómo comprobarlo", () => {
  assert.throws(() => criterioJson("lectura-barata", "no-existe"), (e) => esErrorConSalida(e, /no tiene el criterio/, /node --test pruebas\/rubrica/));
});

test("un criterio sin métrica dice dónde corregirlo", () => {
  const sinMetrica = { ...criterioJson("escritura-verificada", "huella-de-lectura"), metrica: undefined };
  assert.throws(() => porMetrica(sinMetrica, 1), (e) => esErrorConSalida(e, /no tiene metrica/, /criterios\.json/));
});

test("un JSON generado mal formado sale con un siguiente paso", () => {
  assert.throws(
    () => conCabecera({ ruta: "ax/x.json", contenido: "[]\n", comentario: "json", motivo: "x" }, "a".repeat(64)),
    (e) => esErrorConSalida(e, /empezar con «\{»/, /repórtalo/),
  );
});

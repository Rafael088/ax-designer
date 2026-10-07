// La escala (regla del crítico, cobertura mínima, eje entero no-aplica, la fórmula de
// puntuación) probada directo sobre CriterioDecidido[] a mano, sin pasar por las heurísticas de
// un evaluar() concreto: eso es de pruebas/rubrica/evaluar.test.ts. `escritura-verificada` sirve
// de eje de prueba porque tiene pesos distintos (3, 2, 2, 1) y un criterio crítico y uno corrida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { criterioJson, cumple, noAplica, noCumple, parcial, sinEvidencia } from "../../src/rubrica/comun.ts";
import { ordenarHallazgos, puntuarEje } from "../../src/rubrica/rubrica.ts";
import type { Eje, Hallazgo } from "../../src/modelo/index.ts";

const EJE = "escritura-verificada";
const huella = criterioJson(EJE, "huella-de-lectura"); // peso 3, crítico
const atomica = criterioJson(EJE, "escritura-atomica"); // peso 2
const reintento = criterioJson(EJE, "reintento-seguro"); // peso 2, fuente corrida
const ensayo = criterioJson(EJE, "ensayo-antes-de-escribir"); // peso 1

test("un crítico en no-cumple no deja pasar el eje de nivel 1, aunque la puntuación sea suficiente", () => {
  const eje = puntuarEje(EJE, [
    noCumple(huella, "se pisa en silencio"),
    cumple(atomica, "temporal + rename"),
    sinEvidencia(reintento, "exige correr el repo"),
    cumple(ensayo, "--aplicar por defecto"),
  ]);
  assert.equal(eje.puntuacion, 50, "round(100*(3*0+2*2+1*2)/((3+2+1)*2)) = 50");
  assert.equal(eje.cobertura, 0.75, "6 de peso 8: reintento (sin-evidencia) aplica pero no cuenta");
  assert.equal(eje.nombre_nivel, "incipiente", "50 cae en suficiente, pero el crítico lo topa a incipiente");
  assert.equal(eje.nivel, 1);
  assert.equal(eje.no_aplica, false);
});

test("sin el crítico en no-cumple, la misma puntuación da el nivel que le toca", () => {
  const eje = puntuarEje(EJE, [
    cumple(huella, "huella comparada"),
    noCumple(atomica, "sin temporal ni rename"),
    sinEvidencia(reintento, "exige correr el repo"),
    noCumple(ensayo, "sin bandera de ensayo"),
  ]);
  // round(100*(3*2+2*0+1*0)/((3+2+1)*2)) = round(100*6/12) = 50
  assert.equal(eje.puntuacion, 50);
  assert.equal(eje.nombre_nivel, "suficiente");
  assert.equal(eje.nivel, 2);
});

test("con menos de la mitad del peso decidido, el eje queda sin nivel aunque la puntuación sea alta", () => {
  const eje = puntuarEje(EJE, [
    sinEvidencia(huella, "no se puede decidir"),
    sinEvidencia(atomica, "no se puede decidir"),
    sinEvidencia(reintento, "exige correr el repo"),
    cumple(ensayo, "--aplicar por defecto"),
  ]);
  assert.equal(eje.cobertura, 0.13, "solo ensayo (peso 1) de 8 cuenta, redondeado a dos decimales");
  assert.equal(eje.puntuacion, 100, "round(100*1*2/(1*2)) = 100: el único que cuenta, cumple");
  assert.equal(eje.nivel, null, "cobertura 0.125 < 0.5: sin evaluar");
  assert.equal(eje.nombre_nivel, null);
});

test("si todos los criterios del eje son no-aplica, el eje entero es no-aplica y no cuenta como 0", () => {
  const eje = puntuarEje(EJE, [
    noAplica(huella, "el proyecto no escribe estado del dominio"),
    noAplica(atomica, "el proyecto no escribe estado del dominio"),
    noAplica(reintento, "el proyecto no escribe estado del dominio"),
    noAplica(ensayo, "no hay operaciones de efecto grande o irreversible"),
  ]);
  assert.equal(eje.no_aplica, true);
  assert.equal(eje.puntuacion, null);
  assert.equal(eje.nivel, null);
  assert.equal(eje.cobertura, null);
  assert.match(eje.motivo_no_aplica!, /no escribe estado del dominio/);
  assert.deepEqual(eje.hallazgos, []);
});

test("solo los criterios en parcial o no-cumple son hallazgos, con su brecha", () => {
  const eje = puntuarEje(EJE, [
    noCumple(huella, "se pisa en silencio"),
    parcial(atomica, "algunas escrituras son atómicas"),
    sinEvidencia(reintento, "exige correr el repo"),
    cumple(ensayo, "--aplicar por defecto"),
  ]);
  assert.deepEqual(eje.hallazgos.map((h) => [h.criterio, h.resultado, h.brecha, h.critico]), [
    [huella.id, "no-cumple", 6, true],
    [atomica.id, "parcial", 2, false],
  ]);
});

function ejeFalso(hallazgos: Hallazgo[]): Eje {
  return { id: "e", numero: 1, nombre: "E", pregunta: "enterarse", puntuacion: null, nivel: null, nombre_nivel: null, cobertura: null, no_aplica: false, motivo_no_aplica: null, criterios: [], hallazgos };
}

function hallazgo(sobre: Partial<Hallazgo>): Hallazgo {
  return { criterio: "x", eje: "e", numero_eje: 1, orden_criterio: 0, resultado: "no-cumple", critico: false, brecha: 2, impacto: "riesgo", ahorro_tokens: null, motivo: "m", evidencia: [], ...sobre };
}

test("ordenarHallazgos: primero los críticos en no-cumple, sin importar la brecha", () => {
  const critico = hallazgo({ criterio: "critico", critico: true, resultado: "no-cumple", brecha: 1 });
  const grande = hallazgo({ criterio: "grande", critico: false, brecha: 100 });
  const orden = ordenarHallazgos([ejeFalso([grande, critico])]);
  assert.deepEqual(orden.map((h) => h.criterio), ["critico", "grande"]);
});

test("ordenarHallazgos: un crítico que no está en no-cumple (está en parcial) no se adelanta por serlo", () => {
  const criticoParcial = hallazgo({ criterio: "critico-parcial", critico: true, resultado: "parcial", brecha: 1 });
  const grande = hallazgo({ criterio: "grande", critico: false, resultado: "no-cumple", brecha: 10 });
  const orden = ordenarHallazgos([ejeFalso([criticoParcial, grande])]);
  assert.deepEqual(orden.map((h) => h.criterio), ["grande", "critico-parcial"]);
});

test("ordenarHallazgos: a igual brecha, gana el que más tokens ahorraría", () => {
  const pocoAhorro = hallazgo({ criterio: "poco", brecha: 4, impacto: "contexto", ahorro_tokens: 10 });
  const muchoAhorro = hallazgo({ criterio: "mucho", brecha: 4, impacto: "contexto", ahorro_tokens: 500 });
  const sinAhorro = hallazgo({ criterio: "sin-medicion", brecha: 4, impacto: "riesgo", ahorro_tokens: null });
  const orden = ordenarHallazgos([ejeFalso([sinAhorro, pocoAhorro, muchoAhorro])]);
  assert.deepEqual(orden.map((h) => h.criterio), ["mucho", "poco", "sin-medicion"]);
});

test("ordenarHallazgos: a igualdad total, por número de eje y luego por el orden del criterio", () => {
  const ejeDos = hallazgo({ criterio: "eje2-orden0", numero_eje: 2, orden_criterio: 0, brecha: 3 });
  const ejeUnoOrden1 = hallazgo({ criterio: "eje1-orden1", numero_eje: 1, orden_criterio: 1, brecha: 3 });
  const ejeUnoOrden0 = hallazgo({ criterio: "eje1-orden0", numero_eje: 1, orden_criterio: 0, brecha: 3 });
  const orden = ordenarHallazgos([ejeFalso([ejeDos, ejeUnoOrden1, ejeUnoOrden0])]);
  assert.deepEqual(orden.map((h) => h.criterio), ["eje1-orden0", "eje1-orden1", "eje2-orden0"]);
});

test("el orden es estable: da lo mismo en cualquier orden de entrada", () => {
  const a = hallazgo({ criterio: "a", brecha: 5 });
  const b = hallazgo({ criterio: "b", brecha: 5, orden_criterio: 1 });
  const una = ordenarHallazgos([ejeFalso([a, b])]).map((h) => h.criterio);
  const otra = ordenarHallazgos([ejeFalso([b, a])]).map((h) => h.criterio);
  assert.deepEqual(una, otra);
});

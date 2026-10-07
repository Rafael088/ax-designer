// El plan y su estimación sobre node-cli: tarea × {sin, con} × repeticiones, lo leído en cada
// variante en tokens del Contador, y precios que salen de una tabla con su fuente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { contarTokens } from "../../src/medicion/index.ts";
import { armarPlan, ensayarValidacion, leerPrecios, PRECIOS_POR_DEFECTO, precioDe } from "../../src/validador/index.ts";
import { motorDeMentira } from "../../src/validador/motores/index.ts";
import { ErrorAx } from "../../src/modelo/index.ts";
import { REPOS, huellaDelArbol, pedidoPara } from "./ayuda.ts";

const NODE_CLI = join(REPOS, "node-cli");

function planDe(repeticiones: number, extra = {}) {
  const p = pedidoPara(NODE_CLI, motorDeMentira());
  return armarPlan(p.tareas, p.medicion, p.contrato, { raiz: NODE_CLI, motor: "mentira", repeticiones, ensayo: true, tabla: PRECIOS_POR_DEFECTO, ...extra });
}

test("el plan es cada tarea × {sin, con} × repeticiones, alternando el orden de las variantes", () => {
  const plan = planDe(2);
  assert.equal(plan.total.corridas, 2 * 2 * 2);
  assert.deepEqual(plan.corridas.slice(0, 4).map((c) => c.id), ["titulo-de-t-1/sin/1", "titulo-de-t-1/con/1", "titulo-de-t-1/con/2", "titulo-de-t-1/sin/2"]);
  assert.equal(new Set(plan.corridas.map((c) => c.id)).size, plan.corridas.length);
});

test("la estimación sale de la medición y del contrato, en tokens del Contador", () => {
  const p = pedidoPara(NODE_CLI, motorDeMentira());
  const plan = planDe(1);
  const sin = plan.corridas.find((c) => c.id === "titulo-de-t-1/sin/1")!.estimacion;
  const con = plan.corridas.find((c) => c.id === "titulo-de-t-1/con/1")!.estimacion;
  const caro = p.medicion.caminos.find((c) => c.id === "estado-dominio")!;
  assert.ok(sin.lecturas.some((l) => l.tokens === caro.tokens && l.archivos.join() === caro.archivos.join()), "el «sin» lee el estado del dominio");
  assert.ok(con.lecturas.some((l) => /tools del MCP/.test(l.que)), "el «con» carga las definiciones de las tools");
  assert.ok(con.lecturas.some((l) => /«estado»/.test(l.que) && l.tokens === p.contrato.lecturas[0]!.presupuesto_tokens));
  assert.equal(sin.lecturas[0]!.tokens, contarTokens(p.tareas.tareas[0]!.enunciado.length));
  assert.ok(con.rondas < sin.rondas, "con la lectura barata hacen falta menos rondas");
  assert.equal(sin.usd_tope, 0.5);
  const { contexto_base_tokens: base } = PRECIOS_POR_DEFECTO.supuestos;
  const fijo = base + sin.lecturas.slice(0, 2).reduce((a, l) => a + l.tokens, 0);
  assert.equal(sin.tokens_entrada, fijo * sin.rondas + caro.tokens * Math.ceil(sin.rondas / 2), "la fórmula declarada");
});

test("los totales suman las corridas y el tope es la suma de los presupuestos", () => {
  const plan = planDe(3);
  assert.equal(plan.total.usd_tope, 3 * (0.5 + 0.5 + 0.75 + 0.75));
  assert.equal(plan.total.tokens_entrada, plan.corridas.reduce((a, c) => a + c.estimacion.tokens_entrada, 0));
  assert.ok(plan.total.usd! > 0 && plan.total.usd! < plan.total.usd_tope);
});

test("el precio viene de la tabla con su fuente; un modelo sin precio deja usd en null y lo dice", () => {
  const plan = planDe(1);
  assert.equal(plan.estimacion.precios.verificado, false);
  assert.match(plan.estimacion.precios.fuente, /anthropic\.com/);
  assert.ok(plan.notas.some((n) => /no están verificados/.test(n)));
  assert.deepEqual(precioDe(PRECIOS_POR_DEFECTO, "claude-sonnet-9"), PRECIOS_POR_DEFECTO.modelos["sonnet"]);

  const p = pedidoPara(NODE_CLI, motorDeMentira());
  const otro = armarPlan({ ...p.tareas, modelo: "gpt-raro" }, p.medicion, p.contrato, { raiz: NODE_CLI, motor: "mentira", repeticiones: 1, ensayo: true, tabla: PRECIOS_POR_DEFECTO });
  assert.equal(otro.total.usd, null);
  assert.ok(otro.notas.some((n) => /No hay precio para el modelo «gpt-raro»/.test(n)));
});

test("una tabla de precios propia reemplaza la de serie, y una sin fuente es un 2", () => {
  const propia = leerPrecios(JSON.stringify({ ...PRECIOS_POR_DEFECTO, fuente: "mi factura", verificado: true, modelos: { sonnet: { entrada: 0, salida: 0, escritura_cache: 0, lectura_cache: 0 } } }));
  assert.equal(planDe(1, { tabla: propia }).total.usd, 0);
  assert.throws(() => leerPrecios(JSON.stringify({ ...PRECIOS_POR_DEFECTO, fuente: "" })), (e: unknown) => e instanceof ErrorAx && e.codigo === 2 && /fuente/.test(e.message));
});

test("el ensayo no copia, no escribe y no llama al motor", () => {
  const antes = huellaDelArbol(NODE_CLI);
  const motor = motorDeMentira();
  const plan = ensayarValidacion(pedidoPara(NODE_CLI, motor));
  assert.equal(plan.ensayo, true);
  assert.equal(motor.pedidos.length, 0);
  assert.equal(huellaDelArbol(NODE_CLI), antes);
});

test("el ensayo falla donde fallaría la corrida: motor no disponible sale con 3, la salida y el plan", () => {
  const motor = motorDeMentira({ noDisponible: { error: "No está.", salida: "Instálalo." } });
  try {
    ensayarValidacion(pedidoPara(NODE_CLI, motor));
    assert.fail("debía fallar");
  } catch (e) {
    assert.ok(e instanceof ErrorAx);
    assert.equal(e.codigo, 3);
    assert.equal(e.salida, "Instálalo.");
    assert.equal((e.datos?.["plan"] as { total: { corridas: number } }).total.corridas, 4);
  }
});

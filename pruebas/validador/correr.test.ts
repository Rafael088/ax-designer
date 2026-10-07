// Correr la validación con un motor de mentira sobre una copia de node-cli: el verificador de
// verdad comprueba el criterio en la copia, la comparación sale de lo que «hizo» cada variante y
// el resultado queda en .ax-corridas/. Ningún agente se lanza.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SalidaDelMotor, Variante } from "../../src/modelo/index.ts";
import { comparar, correrValidacion, type PedidoDeCorrida } from "../../src/validador/index.ts";
import { motorDeMentira, verificador, type Jugada } from "../../src/validador/motores/index.ts";
import { copiaDe, huellaDelArbol, pedidoPara } from "./ayuda.ts";

const FECHA = new Date("2026-10-07T12:00:00.000Z");

function jugada(rondas: number, tokens: number, respuesta = "", extra: Partial<Jugada> = {}): Jugada {
  return { ok: true, rondas, uso: { entrada: tokens, salida: 0, escritura_cache: 0, lectura_cache: 0 }, usd: tokens / 1_000_000, acabo: true, motivo: "success", respuesta, duracion_ms: 1, ...extra } as Jugada;
}

const ENTREGA = '{"evento":"entregar","id":"t-1","evidencia":"npm test pasa"}\n';

/** Un «agente» que hace bien las dos tareas, gastando lo que diga `gasto` según la variante. */
function haceBien(gasto: Record<Variante, [number, number]>) {
  return (p: PedidoDeCorrida): Jugada => {
    const [rondas, tokens] = gasto[p.corrida.variante];
    if (p.corrida.tarea === "titulo-de-t-1") return jugada(rondas, tokens, "Medir");
    const bitacora = readFileSync(join(p.cwd, "data", "bitacora.jsonl"), "utf8");
    return { ...jugada(rondas, tokens, "listo"), escribe: { "data/bitacora.jsonl": bitacora + ENTREGA } };
  };
}

function correr(guion: (p: PedidoDeCorrida) => Jugada | SalidaDelMotor) {
  const repo = copiaDe("node-cli");
  const antes = huellaDelArbol(repo);
  const motor = motorDeMentira({ guion: guion as (p: PedidoDeCorrida) => Jugada });
  const hecho = correrValidacion(pedidoPara(repo, motor), verificador(), () => FECHA);
  return { repo, antes, motor, hecho };
}

test("con mejor: las dos terminan y con la herramienta gasta menos; queda en .ax-corridas/ y el repo no cambia", () => {
  const { repo, antes, motor, hecho } = correr(haceBien({ sin: [6, 40_000], con: [2, 20_000] }));
  assert.deepEqual(hecho.comparacion.tareas.map((t) => t.veredicto), ["con-mejor", "con-mejor"]);
  const t = hecho.comparacion.tareas[1]!;
  assert.equal(t.sin.terminadas, 1);
  assert.deepEqual(t.diferencia, { tasa_terminado: 0, rondas: -4, tokens: -20_000, usd: -0.02 });
  assert.ok(hecho.resultados.every((r) => r.estado === "corrida" && r.termino), JSON.stringify(hecho.resultados));

  assert.equal(hecho.escrito.ruta, ".ax-corridas/2026-10-07T12-00-00-000Z-" + hecho.plan.contrato.slice(0, 8) + ".json");
  const guardado = JSON.parse(readFileSync(join(repo, hecho.escrito.ruta), "utf8"));
  assert.deepEqual(guardado.comparacion, hecho.comparacion);
  assert.equal(guardado.plan.ensayo, false);
  assert.equal(huellaDelArbol(repo, [".ax-corridas"]), antes, "fuera de .ax-corridas/ el repo no cambió");
  assert.deepEqual(readdirSync(repo).filter((n) => n.startsWith(".ax")), [".ax-corridas"]);

  const con = motor.pedidos.find((p) => p.corrida.variante === "con")!;
  const sin = motor.pedidos.find((p) => p.corrida.variante === "sin")!;
  assert.equal(sin.mcp, null);
  assert.equal(con.mcp!.nombre, "tareas");
  assert.match(con.mcp!.servidor, /ax\/mcp\/servidor\.mjs$/);
  assert.equal(con.modelo, "sonnet");
  assert.notEqual(con.cwd, sin.cwd);
  assert.ok(motor.pedidos.every((p) => !existsSync(p.cwd)), "las copias se borran al acabar");
});

test("con peor: terminan igual y con la herramienta gasta más", () => {
  const { hecho } = correr(haceBien({ sin: [2, 10_000], con: [5, 30_000] }));
  assert.deepEqual(hecho.comparacion.tareas.map((t) => t.veredicto), ["con-peor", "con-peor"]);
});

test("no terminó: si el «con» no hace la tarea pierde aunque gaste menos, y si ninguna termina es empate", () => {
  const bien = haceBien({ sin: [6, 40_000], con: [1, 5_000] });
  const { hecho } = correr((p) => (p.corrida.variante === "con" ? jugada(1, 5_000, "no sé") : bien(p)));
  assert.deepEqual(hecho.comparacion.tareas.map((t) => t.veredicto), ["con-peor", "con-peor"]);
  assert.match(hecho.comparacion.tareas[0]!.por_que, /termina menos veces \(0\/1 contra 1\/1\)/);
  const ninguna = correr(() => jugada(3, 1_000, "nada", { acabo: false, motivo: "error_max_turns" })).hecho;
  assert.deepEqual(ninguna.comparacion.tareas.map((t) => t.veredicto), ["empate", "empate"]);
  const r = ninguna.resultados[0]!;
  assert.ok(r.estado === "corrida" && !r.acabo && r.motivo === "error_max_turns" && !r.termino);
});

test("motor falla: las corridas fallidas no cuentan y, sin ninguna válida de un lado, es sin-datos", () => {
  const bien = haceBien({ sin: [3, 10_000], con: [2, 5_000] });
  const { hecho } = correr((p) => {
    if (p.corrida.variante === "sin") return bien(p);
    if (p.corrida.tarea === "titulo-de-t-1") throw new Error("se cayó");
    return { ok: false, error: "claude no devolvió JSON", detalle: "segfault" };
  });
  assert.deepEqual(hecho.comparacion.tareas.map((t) => t.veredicto), ["sin-datos", "sin-datos"]);
  const fallos = hecho.resultados.filter((r) => r.estado === "fallo-motor");
  assert.equal(fallos.length, 2);
  assert.ok(fallos.some((f) => f.estado === "fallo-motor" && f.detalle === "se cayó"));
  assert.equal(hecho.comparacion.tareas[0]!.con.fallos_del_motor, 1);
});

test("comparar usa medianas y deja fuera los fallos del motor", () => {
  const base = { tarea: "t", repeticion: 1, estimacion: {} as never };
  const corrida = (variante: Variante, rondas: number, tokens: number, termino = true) => ({
    ...base, id: `t/${variante}/${rondas}`, variante, estado: "corrida" as const, rondas, uso: { entrada: tokens, salida: 0, escritura_cache: 0, lectura_cache: 0 }, tokens, usd: null, acabo: true, motivo: "success", termino, comprobacion: "", duracion_ms: 0,
  });
  const c = comparar([
    corrida("sin", 4, 100), corrida("sin", 6, 300), corrida("sin", 100, 9_000),
    corrida("con", 2, 50), corrida("con", 3, 70),
    { ...base, id: "t/con/x", variante: "con", estado: "fallo-motor", error: "x", detalle: "" },
  ]);
  const t = c.tareas[0]!;
  assert.equal(t.sin.rondas, 6);
  assert.equal(t.con.tokens, 60);
  assert.equal(t.con.fallos_del_motor, 1);
  assert.equal(t.sin.usd, null);
  assert.equal(t.veredicto, "con-mejor");
  assert.deepEqual(c.veredictos, { "con-mejor": 1, "con-peor": 0, empate: 0, "sin-datos": 0 });
});

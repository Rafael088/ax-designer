// El motor de verdad sin ejecutarlo: se le inyecta un lanzador que anota lo que se le pidió y
// devuelve una salida escrita a mano, y un buscador del PATH de mentira. Nunca se lanza `claude`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorAx } from "../../../src/modelo/index.ts";
import type { PedidoDeCorrida } from "../../../src/validador/index.ts";
import { HERRAMIENTAS_BASE, argvDeClaude, leerSalidaDeClaude, motorClaude, rutaDeConfigMcp, type Lanzador } from "../../../src/validador/motores/index.ts";

type Llamada = { programa: string; argv: readonly string[]; cwd: string; segundos: number };

function lanzadorFalso(respuesta: { codigo: number | null; stdout: string; stderr?: string; error?: string | null }) {
  const llamadas: Llamada[] = [];
  const lanzar: Lanzador = (programa, argv, o) => {
    llamadas.push({ programa, argv, cwd: o.cwd, segundos: o.segundos });
    return { codigo: respuesta.codigo, stdout: respuesta.stdout, stderr: respuesta.stderr ?? "", error: respuesta.error ?? null };
  };
  return { lanzar, llamadas };
}

const RESULTADO = JSON.stringify({
  type: "result", subtype: "success", is_error: false, num_turns: 4, duration_ms: 1234, total_cost_usd: 0.0567, result: "Medir",
  usage: { input_tokens: 10, output_tokens: 300, cache_creation_input_tokens: 15000, cache_read_input_tokens: 40000 },
});

function pedido(variante: "sin" | "con"): PedidoDeCorrida {
  const temporal = mkdtempSync(join(tmpdir(), "axd-claude-"));
  return {
    corrida: { id: `titulo/${variante}/1`, tarea: "titulo", variante, repeticion: 1, estimacion: {} as never },
    cwd: join(temporal, "repo"),
    enunciado: "¿Cuál es el título de t-1? --no-es-una-bandera",
    modelo: "sonnet",
    presupuesto: { rondas: 10, usd: 0.5, segundos: 300 },
    mcp: variante === "con" ? { nombre: "tareas", servidor: join(temporal, "repo", "ax", "mcp", "servidor.mjs") } : null,
    temporal,
  };
}

test("el argv del «sin»: -p con el enunciado como un solo argumento, stream-json, topes y sin ningún MCP", () => {
  assert.deepEqual(argvDeClaude(pedido("sin")), [
    "-p", "¿Cuál es el título de t-1? --no-es-una-bandera",
    "--output-format", "stream-json",
    "--verbose",
    "--model", "sonnet",
    "--max-turns", "10",
    "--max-budget-usd", "0.5",
    "--permission-mode", "acceptEdits",
    "--allowedTools", HERRAMIENTAS_BASE.join(","),
    "--strict-mcp-config",
  ]);
});

test("el argv del «con»: las mismas herramientas más las del MCP generado, por --mcp-config", () => {
  const p = pedido("con");
  const argv = argvDeClaude(p);
  assert.equal(argv[argv.indexOf("--allowedTools") + 1], [...HERRAMIENTAS_BASE, "mcp__tareas"].join(","));
  assert.deepEqual(argv.slice(-3), ["--strict-mcp-config", "--mcp-config", rutaDeConfigMcp(p)]);
});

test("correr lanza claude en la copia con el tope de tiempo, escribe la config del MCP y lee el resultado", () => {
  const { lanzar, llamadas } = lanzadorFalso({ codigo: 0, stdout: RESULTADO });
  const p = pedido("con");
  const salida = motorClaude({ lanzador: lanzar, buscar: () => "/usr/bin/claude" }).correr(p);
  assert.equal(llamadas.length, 1);
  assert.deepEqual({ ...llamadas[0], argv: undefined }, { programa: "claude", argv: undefined, cwd: p.cwd, segundos: 300 });
  assert.deepEqual(llamadas[0]!.argv, argvDeClaude(p));
  assert.deepEqual(JSON.parse(readFileSync(rutaDeConfigMcp(p), "utf8")), { mcpServers: { tareas: { command: "node", args: [p.mcp!.servidor] } } });
  assert.deepEqual(salida, {
    ok: true, rondas: 4, usd: 0.0567, acabo: true, motivo: "success", respuesta: "Medir", duracion_ms: 1234,
    uso: { entrada: 10, salida: 300, escritura_cache: 15000, lectura_cache: 40000 },
    transcripcion: RESULTADO,
  });
});

// Una salida grabada de `claude -p --output-format stream-json --verbose` (la tarea «ventas de la
// semana» sobre el restaurante de la demo, recortada y sin rutas ni ids de sesión).
const GRABADA = readFileSync(join(import.meta.dirname, "..", "fixtures", "claude-stream-json.jsonl"), "utf8");

test("stream-json: el uso, el costo y la respuesta salen del evento result, y la transcripción entera vuelve tal cual", () => {
  const salida = leerSalidaDeClaude(GRABADA, "", 0, null);
  assert.ok(salida.ok);
  assert.equal(salida.rondas, 9);
  assert.equal(salida.usd, 0.18016880000000002);
  assert.deepEqual(salida.uso, { entrada: 18, salida: 2103, escritura_cache: 26832, lectura_cache: 258874 });
  assert.equal(salida.acabo, true);
  assert.match(salida.respuesta, /Bandeja paisa/);
  assert.equal(salida.duracion_ms, 24328);
  assert.equal(salida.transcripcion, GRABADA, "la transcripción es lo que imprimió claude, sin tocar");
  const eventos = GRABADA.trim().split("\n").map((l) => JSON.parse(l) as { type: string });
  assert.equal(eventos[0]!.type, "system");
  assert.equal(eventos.at(-1)!.type, "result");
});

test("stream-json: un evento después del result o líneas que no son JSON no confunden; sin result es fallo del motor con la transcripción", () => {
  const conRuido = `aviso: algo por stdout\n${GRABADA}{"type":"system","subtype":"fin"}\n`;
  const bien = leerSalidaDeClaude(conRuido, "", 0, null);
  assert.ok(bien.ok && bien.rondas === 9);
  const cortada = GRABADA.split("\n").slice(0, 5).join("\n") + "\n";
  const mal = leerSalidaDeClaude(cortada, "se acabó el tiempo", null, "pasó el tope de 300 s");
  assert.ok(!mal.ok);
  assert.match(mal.error, /evento de resultado/);
  assert.equal(mal.transcripcion, cortada, "lo que alcanzó a imprimir se guarda igual");
  const tope = leerSalidaDeClaude(cortada + JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 10, usage: {} }) + "\n", "", 1, null);
  assert.ok(tope.ok && !tope.acabo && tope.motivo === "error_max_turns" && tope.rondas === 10);
});

test("leer la salida: tope de rondas no es acabar, y sin JSON de resultado es un fallo del motor", () => {
  const tope = leerSalidaDeClaude(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 10, usage: {} }), "", 1, null);
  assert.ok(tope.ok && !tope.acabo && tope.motivo === "error_max_turns" && tope.rondas === 10 && tope.usd === null);
  const basura = leerSalidaDeClaude("Error: not logged in", "Invalid API key", 1, null);
  assert.ok(!basura.ok);
  assert.match(basura.detalle, /Invalid API key/);
  const tiempo = leerSalidaDeClaude("", "", null, "pasó el tope de 300 s");
  assert.ok(!tiempo.ok && /300 s/.test(tiempo.detalle));
});

test("disponible: sin claude en el PATH dice cómo instalarlo y que existe --motor mentira, sin lanzar nada", () => {
  const { lanzar, llamadas } = lanzadorFalso({ codigo: 0, stdout: "" });
  const falta = motorClaude({ lanzador: lanzar, buscar: () => null }).disponible({ con: true });
  assert.ok(falta !== null);
  assert.match(falta.error, /claude/);
  assert.match(falta.salida, /--motor mentira/);
  const sinNpm = motorClaude({ lanzador: lanzar, buscar: (p) => (p === "npm" ? null : `/bin/${p}`) }).disponible({ con: true });
  assert.match(sinNpm!.error, /npm/);
  assert.equal(motorClaude({ lanzador: lanzar, buscar: (p) => `/bin/${p}` }).disponible({ con: true }), null);
  assert.equal(motorClaude({ lanzador: lanzar, buscar: (p) => (p === "npm" ? null : `/bin/${p}`) }).disponible({ con: true, mcp: false }), null, "solo con el CLI no hace falta npm");
  assert.equal(llamadas.length, 0);
});

test("prepararCon instala el SDK en ax/mcp de la copia, y si npm falla sale con 3 reintentable", () => {
  const bien = lanzadorFalso({ codigo: 0, stdout: "" });
  motorClaude({ lanzador: bien.lanzar }).prepararCon("/tmp/copia");
  assert.equal(bien.llamadas[0]!.programa, "npm");
  assert.equal(bien.llamadas[0]!.argv[0], "install");
  assert.equal(bien.llamadas[0]!.cwd, join("/tmp/copia", "ax", "mcp"));
  const mal = lanzadorFalso({ codigo: 1, stdout: "", stderr: "ENOTFOUND registry.npmjs.org" });
  assert.throws(() => motorClaude({ lanzador: mal.lanzar }).prepararCon("/tmp/copia"), (e: unknown) => e instanceof ErrorAx && e.codigo === 3 && e.reintentable && /ENOTFOUND/.test(String(e.datos?.["detalle"])));
});

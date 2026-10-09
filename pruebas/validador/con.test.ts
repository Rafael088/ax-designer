// Lo que lleva la copia «con» según --con (cli, mcp, ambos) y las transcripciones que el validador
// guarda de cada corrida en .ax-corridas/. Con el motor de mentira: ningún agente se lanza. El
// guion mira la copia mientras «corre», porque al acabar se borra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModoCon, ResultadoDeCorrida } from "../../src/modelo/index.ts";
import { correrValidacion, ensayarValidacion, lineaDeLaGuia, type PedidoDeCorrida } from "../../src/validador/index.ts";
import { motorDeMentira, verificador, type Jugada } from "../../src/validador/motores/index.ts";
import { copiaDe, huellaDelArbol, pedidoPara } from "./ayuda.ts";

const FECHA = new Date("2026-10-07T12:00:00.000Z");
const GRABADA = readFileSync(join(import.meta.dirname, "fixtures", "claude-stream-json.jsonl"), "utf8");

type Vista = { variante: string; cli: boolean; leeme: boolean; mcp: boolean; guia: string; mcpDelPedido: boolean };

function jugada(transcripcion?: string): Jugada {
  return {
    ok: true, rondas: 2, uso: { entrada: 100, salida: 10, escritura_cache: 0, lectura_cache: 0 }, usd: 0.001, acabo: true, motivo: "success",
    respuesta: "Medir", duracion_ms: 1, ...(transcripcion !== undefined ? { transcripcion } : {}),
  };
}

/** Corre con --con `con` y anota qué había en cada copia mientras «corría». */
function correrCon(con: ModoCon | undefined) {
  const repo = copiaDe("node-cli");
  const vistas: Vista[] = [];
  let preparados = 0;
  const motor = motorDeMentira({
    prepararCon: () => preparados++,
    guion: (p: PedidoDeCorrida) => {
      vistas.push({
        variante: p.corrida.variante,
        cli: existsSync(join(p.cwd, "ax", "cli.mjs")),
        leeme: existsSync(join(p.cwd, "ax", "cli.md")),
        mcp: existsSync(join(p.cwd, "ax", "mcp", "servidor.mjs")),
        guia: readFileSync(join(p.cwd, "CLAUDE.md"), "utf8"),
        mcpDelPedido: p.mcp !== null,
      });
      return jugada();
    },
  });
  const pedido = pedidoPara(repo, motor, con === undefined ? {} : { con });
  const hecho = correrValidacion(pedido, verificador(), () => FECHA);
  return { repo, vistas, preparados, hecho, linea: lineaDeLaGuia(pedido.contrato) };
}

const ORIGINAL = readFileSync(join(import.meta.dirname, "..", "repos", "node-cli", "CLAUDE.md"), "utf8");

test("--con cli: el «con» lleva el CLI y la línea en la guía que apunta a ax/cli.md, y ni MCP ni npm install", () => {
  const { vistas, preparados, hecho, linea } = correrCon("cli");
  assert.equal(hecho.plan.con, "cli");
  assert.match(linea, /node ax\/cli\.mjs --help/);
  assert.match(linea, /ax\/cli\.md/);
  for (const v of vistas.filter((x) => x.variante === "con")) {
    assert.deepEqual({ cli: v.cli, leeme: v.leeme, mcp: v.mcp, mcpDelPedido: v.mcpDelPedido }, { cli: true, leeme: true, mcp: false, mcpDelPedido: false });
    assert.equal(v.guia, `${ORIGINAL.replace(/\n*$/, "")}\n\n${linea}\n`, "la línea se añade al final de CLAUDE.md, sin tocar lo que había");
  }
  for (const v of vistas.filter((x) => x.variante === "sin")) {
    assert.deepEqual({ cli: v.cli, mcp: v.mcp, mcpDelPedido: v.mcpDelPedido }, { cli: false, mcp: false, mcpDelPedido: false });
    assert.equal(v.guia, ORIGINAL, "el «sin» va con la guía tal cual");
  }
  assert.equal(preparados, 0, "sin MCP no se instala su SDK");
});

test("--con mcp: el CLI y el MCP, sin la línea en la guía (lo de antes de --con)", () => {
  const { vistas, preparados } = correrCon("mcp");
  for (const v of vistas.filter((x) => x.variante === "con")) {
    assert.deepEqual({ cli: v.cli, mcp: v.mcp, mcpDelPedido: v.mcpDelPedido, guia: v.guia }, { cli: true, mcp: true, mcpDelPedido: true, guia: ORIGINAL });
  }
  assert.equal(preparados, 1);
});

test("sin --con es ambos: el CLI, el MCP y la línea en la guía", () => {
  const { vistas, preparados, hecho, linea } = correrCon(undefined);
  assert.equal(hecho.plan.con, "ambos");
  for (const v of vistas.filter((x) => x.variante === "con")) {
    assert.ok(v.cli && v.mcp && v.mcpDelPedido && v.guia.endsWith(`${linea}\n`));
  }
  assert.equal(preparados, 1);
});

test("--con cli no exige npm: el motor solo pide lo del MCP cuando lo hay", () => {
  const repo = copiaDe("node-cli");
  const pedidos: { con: boolean; mcp?: boolean }[] = [];
  const motor = { ...motorDeMentira(), disponible: (v: { con: boolean; mcp?: boolean }) => (pedidos.push(v), null) };
  ensayarValidacion(pedidoPara(repo, motor, { con: "cli" }));
  ensayarValidacion(pedidoPara(repo, motor));
  assert.deepEqual(pedidos, [{ con: true, mcp: false }, { con: true, mcp: true }]);
});

test("transcripciones: cada corrida deja la suya en .ax-corridas/<corrida>/ y el resultado dice dónde; el repo no cambia fuera de ahí", () => {
  const repo = copiaDe("node-cli");
  const antes = huellaDelArbol(repo);
  const motor = motorDeMentira({
    guion: (p: PedidoDeCorrida): Jugada => {
      if (p.corrida.id === "titulo-de-t-1/sin/1") return { ok: false, error: "claude no devolvió el evento de resultado.", detalle: "se cortó", transcripcion: '{"type":"system","subtype":"init"}\n' };
      if (p.corrida.variante === "con") return jugada(GRABADA);
      return jugada();
    },
  });
  const hecho = correrValidacion(pedidoPara(repo, motor), verificador(), () => FECHA);
  const carpeta = ".ax-corridas/2026-10-07T12-00-00-000Z-" + hecho.plan.contrato.slice(0, 8);
  const de = (id: string) => hecho.resultados.find((r) => r.id === id)! as ResultadoDeCorrida & { transcripcion?: string };

  assert.equal(de("titulo-de-t-1/con/1").transcripcion, `${carpeta}/titulo-de-t-1-con-1.jsonl`);
  assert.equal(readFileSync(join(repo, de("titulo-de-t-1/con/1").transcripcion!), "utf8"), GRABADA, "la transcripción se guarda tal cual la dio el motor");
  assert.equal(de("titulo-de-t-1/sin/1").estado, "fallo-motor");
  assert.equal(readFileSync(join(repo, `${carpeta}/titulo-de-t-1-sin-1.jsonl`), "utf8"), '{"type":"system","subtype":"init"}\n', "también la de una corrida fallida");
  const sinTranscripcion = hecho.resultados.find((r) => r.variante === "sin" && r.estado === "corrida")!;
  assert.equal("transcripcion" in sinTranscripcion, false, "si el motor no da transcripción, no se inventa un archivo");

  const guardado = JSON.parse(readFileSync(join(repo, hecho.escrito.ruta), "utf8")) as { resultados: { id: string; transcripcion?: string }[] };
  assert.equal(guardado.resultados.find((r) => r.id === "titulo-de-t-1/con/1")!.transcripcion, `${carpeta}/titulo-de-t-1-con-1.jsonl`);
  assert.equal(huellaDelArbol(repo, [".ax-corridas"]), antes);
});

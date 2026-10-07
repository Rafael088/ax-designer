// La medición contra repos de mentira (en memoria y pruebas/repos/), nunca contra este repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco, lectorEnMemoria } from "../../src/analizador/index.ts";
import { medir } from "../../src/medicion/index.ts";
import type { Camino, Inventario, Medicion } from "../../src/modelo/index.ts";

function medirRepo(archivos: Record<string, string>): Medicion {
  return medir(analizar(lectorEnMemoria(archivos)));
}

function camino(medicion: Medicion, id: string): Camino | undefined {
  return medicion.caminos.find((c) => c.id === id);
}

const bodega = {
  "README.md": "# Herramienta de inventario.\n\nLee el estado de la bodega.",
  "AGENTS.md": "# Guía\n\nCorre `inventario estado`.\n",
  "package.json": JSON.stringify({ name: "inventario", scripts: { test: "node --test" } }),
  "data/estado.json": JSON.stringify({ bodega: "x".repeat(4000) }),
};

test("el camino caro de un estado grande contra una guía corta da la razón de ahorro", () => {
  const m = medirRepo(bodega);
  assert.equal(m.esquema, 1);
  assert.equal(m.caracteres_por_token, 4);
  assert.equal(m.metricas.tokens_guia_de_entrada, Math.round(bodega["AGENTS.md"].length / 4));
  assert.equal(m.metricas.tokens_camino_caro, 1003);
  assert.ok(m.metricas.razon_caro_barato !== null && m.metricas.razon_caro_barato > 100);
  assert.equal(camino(m, "estado-dominio")!.rondas_estimadas, 1);
});

test("la medición es estable y serializable: JSON no le cambia nada", () => {
  const m = medirRepo(bodega);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  assert.deepEqual(medir(analizar(lectorEnMemoria(bodega))), m, "dos mediciones iguales dan lo mismo");
});

test("la cadena de la guía sigue los includes sin repetir el archivo", () => {
  const claude = "# Claude\n\n@AGENTS.md\n";
  const m = medirRepo({ ...bodega, "CLAUDE.md": claude });
  const guia = camino(m, "guia-de-entrada")!;
  assert.deepEqual(guia.archivos, ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(guia.rondas_estimadas, 2);
  assert.equal(guia.caracteres, bodega["AGENTS.md"].length + claude.length);
});

test("el resumen es el camino más barato de los dos: gana el README si cuesta menos", () => {
  const m = medirRepo({
    ...bodega,
    "AGENTS.md": "# Guía larga\n\n" + "lea ".repeat(400),
    "README.md": "# Inventario\n",
  });
  const resumen = camino(m, "resumen")!;
  assert.deepEqual(resumen.archivos, ["README.md"]);
  assert.equal(resumen.tokens, m.metricas.tokens_resumen);
  assert.ok(m.metricas.tokens_guia_de_entrada! > resumen.tokens);
});

test("sin guía de entrada la métrica es null y la nota lo dice; el resumen queda en el README", () => {
  const m = medirRepo({ "README.md": "# Solo readme\n", "package.json": JSON.stringify({ name: "x" }) });
  assert.equal(m.metricas.tokens_guia_de_entrada, null);
  assert.equal(m.metricas.tokens_resumen, 4);
  assert.ok(m.notas.some((n) => n.includes("Sin guía de entrada")));
});

test("sin estado del dominio no hay camino caro y la nota lo dice", () => {
  const m = medirRepo({ "README.md": "# Repo sin estado\n", "src/app.ts": "export const x = 1;" });
  assert.equal(m.metricas.tokens_camino_caro, null);
  assert.equal(m.metricas.razon_caro_barato, null);
  assert.ok(m.notas.some((n) => n.includes("Sin camino caro")));
});

test("sin camino barato se reporta el caro como evidencia y la nota lo avisa", () => {
  const m = medirRepo({ "estado.sqlite": "SQLite format 3\0" + "x".repeat(400), "app.ts": "export const x = 1;" });
  assert.equal(m.metricas.tokens_resumen, null);
  assert.ok(m.metricas.tokens_camino_caro !== null && m.metricas.tokens_camino_caro > 0);
  assert.equal(m.metricas.razon_caro_barato, null);
  assert.ok(m.notas.some((n) => n.includes("No hay camino barato")));
});

test("un estado opaco (sin claves) suma la guía al camino caro: hay que leerla para interpretarlo", () => {
  const m = medirRepo({ ...bodega, "data/estado.sqlite": "SQLite format 3\0" + "x".repeat(800) });
  const caro = camino(m, "estado-dominio")!;
  assert.ok(caro.archivos.includes("AGENTS.md"), "la guía entra en el caro: " + caro.archivos.join(", "));
});

test("lectura-todo siempre está: todos los bytes, una ronda por archivo más el listado", () => {
  const inventario: Inventario = analizar(lectorEnMemoria(bodega));
  const m = medir(inventario);
  const todo = camino(m, "lectura-todo")!;
  assert.equal(todo.rondas_estimadas, inventario.estructura.archivos + 1);
  assert.equal(todo.caracteres, inventario.estructura.bytes);
  assert.deepEqual(todo.archivos, [], "la lista de todos los archivos no viaja en el JSON");
});

test("el repo de mentira node-cli se mide entero y sus números salen del Contador", () => {
  const inventario = analizar(lectorDeDisco(join(import.meta.dirname, "..", "repos", "node-cli")));
  const m = medir(inventario);
  for (const c of m.caminos) {
    assert.equal(c.tokens, Math.round(c.caracteres / m.caracteres_por_token), `${c.id}: los tokens salen del Contador`);
  }
  assert.ok(camino(m, "guia-de-entrada"));
  assert.ok(camino(m, "estado-dominio"));
  assert.ok(camino(m, "resumen"));
});

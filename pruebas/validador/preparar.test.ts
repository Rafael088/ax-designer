// Las copias del validador: «sin» es el repo tal cual, «con» lleva generar cli + mcp aplicados, lo
// que ya generó axd no pasa a ninguna, y el repo original no se toca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { borrarCarpetaTemporal, conCabecera } from "../../src/generadores/index.ts";
import { ErrorAx } from "../../src/modelo/index.ts";
import { copiaParaCorrida, ensayarValidacion, limpiar, prepararPlantillas } from "../../src/validador/index.ts";
import { motorDeMentira } from "../../src/validador/motores/index.ts";
import { copiaDe, huellaDelArbol, pedidoPara } from "./ayuda.ts";

test("«sin» es el repo tal cual y «con» lleva el CLI y el MCP generados; el original no cambia", () => {
  const repo = copiaDe("node-cli");
  const antes = huellaDelArbol(repo);
  const preparadas: string[] = [];
  const motor = motorDeMentira({ prepararCon: (c) => preparadas.push(c) });
  const p = pedidoPara(repo, motor);
  const copias = prepararPlantillas(repo, p.contrato, motor);
  try {
    assert.equal(huellaDelArbol(copias.plantillas.sin), antes, "el «sin» es igual al original");
    assert.ok(!existsSync(join(copias.plantillas.sin, "ax")));
    for (const ruta of ["ax/contrato.json", "ax/cli.mjs", "ax/cli.md", "ax/mcp/servidor.mjs", "ax/mcp/herramientas.mjs", "ax/mcp/package.json"]) {
      assert.ok(existsSync(join(copias.plantillas.con, ruta)), `falta ${ruta} en el «con»`);
    }
    assert.deepEqual(preparadas, [copias.plantillas.con], "el motor prepara el «con» (instalar el SDK)");
    const una = copiaParaCorrida(copias, { id: "t/con/1", tarea: "t", variante: "con", repeticion: 1, estimacion: {} as never });
    assert.equal(huellaDelArbol(una), huellaDelArbol(copias.plantillas.con), "cada corrida trabaja en una copia nueva de su plantilla");
    writeFileSync(join(una, "data", "estado.json"), "{}");
    assert.notEqual(huellaDelArbol(una), huellaDelArbol(copias.plantillas.con));
  } finally {
    limpiar(copias);
  }
  assert.ok(!existsSync(copias.temporal), "limpiar borra las copias");
  assert.equal(huellaDelArbol(repo), antes, "el repo original no se tocó");
});

test("lo que ya generó axd en el repo no pasa a las copias: el «sin» va sin la herramienta", () => {
  const repo = copiaDe("node-cli");
  mkdirSync(join(repo, "ax"));
  const generado = conCabecera({ ruta: "ax/cli.mjs", contenido: "console.log('viejo');\n", comentario: "//", motivo: "" }, "c".repeat(64));
  writeFileSync(join(repo, "ax", "cli.mjs"), generado);
  const motor = motorDeMentira();
  const copias = prepararPlantillas(repo, pedidoPara(repo, motor).contrato, motor);
  try {
    assert.ok(!existsSync(join(copias.plantillas.sin, "ax", "cli.mjs")));
    assert.notEqual(readFileSync(join(copias.plantillas.con, "ax", "cli.mjs"), "utf8"), generado, "el «con» lleva lo generado ahora");
  } finally {
    limpiar(copias);
  }
  assert.equal(readFileSync(join(repo, "ax", "cli.mjs"), "utf8"), generado);
});

test("un archivo de ax/ que no generó axd impide preparar el «con»: el ensayo sale con 5", () => {
  const repo = copiaDe("node-cli");
  mkdirSync(join(repo, "ax"));
  writeFileSync(join(repo, "ax", "cli.mjs"), "// mío\n");
  assert.throws(() => ensayarValidacion(pedidoPara(repo, motorDeMentira())), (e: unknown) => e instanceof ErrorAx && e.codigo === 5 && /ax\/cli\.mjs/.test(e.message));
});

test("si el motor no puede preparar el «con», no queda ninguna copia", () => {
  const repo = copiaDe("node-cli");
  let temporal = "";
  const motor = motorDeMentira({
    prepararCon: (c) => {
      temporal = join(c, "..");
      throw new ErrorAx("sin red", { codigo: 3, salida: "reintenta" });
    },
  });
  assert.throws(() => prepararPlantillas(repo, pedidoPara(repo, motor).contrato, motor), /sin red/);
  assert.ok(temporal !== "" && !existsSync(temporal));
});

test("borrarCarpetaTemporal se niega a borrar lo que no es una carpeta temporal del validador", () => {
  const repo = copiaDe("node-cli");
  assert.throws(() => borrarCarpetaTemporal(repo), (e: unknown) => e instanceof ErrorAx && e.codigo === 3);
  assert.ok(existsSync(repo));
});

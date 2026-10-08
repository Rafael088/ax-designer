// `axd estado` de punta a punta: se lanza el CLI de verdad sobre copias de un repo de mentira y se
// mira lo que imprime, no funciones sueltas. Nada aquí escribe fuera de carpetas temporales ni
// corre `validar --correr`: las corridas se simulan dejando un JSON en .ax-corridas/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const CLI = join(RAIZ, "src", "cli", "main.ts");
const NODE_CLI = join(RAIZ, "pruebas", "repos", "node-cli");

type Estado = {
  esquema: number;
  raiz: string;
  auditoria: { puntuacion_global: number | null; ejes: { numero: number; id: string; puntuacion: number | null; nivel: string | null }[]; criticos: string[]; hallazgos: number };
  contrato: { huella: string; verbos: number };
  generados: { archivos: number; cli: boolean; mcp: boolean; al_dia: boolean | null; de_otro_contrato: number; editados_a_mano: string[] };
  corridas: { total: number; ultima: string | null };
  salida: string;
};

function axd(...argumentos: string[]) {
  const corrida = spawnSync(process.execPath, [CLI, ...argumentos], { encoding: "utf8" });
  return { codigo: corrida.status, stdout: corrida.stdout, json: JSON.parse(corrida.stdout) as Record<string, unknown> };
}

function estado(repo: string): { codigo: number | null; stdout: string; estado: Estado } {
  const { codigo, stdout, json } = axd("estado", repo);
  return { codigo, stdout, estado: json as unknown as Estado };
}

function copiaDeNodeCli(): string {
  const destino = join(mkdtempSync(join(tmpdir(), "axd-estado-")), "node-cli");
  cpSync(NODE_CLI, destino, { recursive: true });
  return destino;
}

/** Cada archivo del repo con su tamaño y fecha: para comprobar que estado no escribe nada. */
function foto(raiz: string): Record<string, string> {
  const salida: Record<string, string> = {};
  const recorrer = (carpeta: string) => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else {
        const s = statSync(ruta);
        salida[relative(raiz, ruta)] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  recorrer(raiz);
  return salida;
}

test("estado sin nada generado: JSON con esquema 1, la puntuación por eje y el siguiente paso es generar", () => {
  const repo = copiaDeNodeCli();
  const { codigo, estado: e } = estado(repo);
  assert.equal(codigo, 0);
  assert.equal(e.esquema, 1);
  assert.equal(e.raiz, repo);
  assert.equal(e.auditoria.ejes.length, 7);
  assert.equal(typeof e.auditoria.puntuacion_global, "number");
  assert.match(e.contrato.huella, /^[0-9a-f]{64}$/);
  assert.deepEqual(e.generados, { archivos: 0, cli: false, mcp: false, al_dia: null, de_otro_contrato: 0, editados_a_mano: [] });
  assert.deepEqual(e.corridas, { total: 0, ultima: null });
  assert.match(e.salida, new RegExp(`axd generar cli ${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("estado coincide con auditar y contrato: misma puntuación, mismos críticos, misma huella", () => {
  const { estado: e } = estado(NODE_CLI);
  const informe = axd("auditar", NODE_CLI).json as { puntuacion_global: number; hallazgos: { criterio: string; critico: boolean; resultado: string }[] };
  const contrato = axd("contrato", NODE_CLI).json as { huella: string; verbos: unknown[] };
  assert.equal(e.auditoria.puntuacion_global, informe.puntuacion_global);
  assert.equal(e.auditoria.hallazgos, informe.hallazgos.length);
  assert.deepEqual(e.auditoria.criticos, informe.hallazgos.filter((h) => h.critico).map((h) => `${h.criterio} (${h.resultado})`));
  assert.equal(e.contrato.huella, contrato.huella);
  assert.equal(e.contrato.verbos, contrato.verbos.length);
});

test("estado cabe en menos de 1k tokens (caracteres/4, el Contador de axd), también sobre el propio axd", () => {
  for (const repo of [NODE_CLI, RAIZ]) {
    const { codigo, stdout } = estado(repo);
    assert.equal(codigo, 0);
    assert.ok(stdout.length / 4 < 1000, `${repo}: ${Math.ceil(stdout.length / 4)} tokens`);
  }
});

test("estado no escribe nada en el repo objetivo", () => {
  const repo = copiaDeNodeCli();
  const antes = foto(repo);
  estado(repo);
  assert.deepEqual(foto(repo), antes);
});

test("estado tras generar cli y mcp: lo generado está al día y el siguiente paso es validar en ensayo", () => {
  const repo = copiaDeNodeCli();
  assert.equal(axd("generar", "cli", repo, "--aplicar").codigo, 0);
  assert.equal(axd("generar", "mcp", repo, "--aplicar").codigo, 0);
  const { codigo, estado: e } = estado(repo);
  assert.equal(codigo, 0);
  assert.ok(e.generados.archivos > 0);
  assert.equal(e.generados.cli, true);
  assert.equal(e.generados.mcp, true);
  assert.equal(e.generados.al_dia, true);
  assert.equal(e.generados.de_otro_contrato, 0);
  assert.deepEqual(e.generados.editados_a_mano, []);
  assert.match(e.salida, /axd validar .* --tareas <archivo>/);
  assert.match(e.salida, /no gasta/);
});

test("estado ve lo editado a mano en ax/ y manda a una persona; ignora node_modules del MCP", () => {
  const repo = copiaDeNodeCli();
  axd("generar", "cli", repo, "--aplicar");
  const generado = (axd("generar", "cli", repo).json["archivos"] as { ruta: string }[])[0]!.ruta;
  writeFileSync(join(repo, generado), readFileSync(join(repo, generado), "utf8") + "\n// tocado a mano\n");
  mkdirSync(join(repo, "ax", "mcp", "node_modules", "x"), { recursive: true });
  writeFileSync(join(repo, "ax", "mcp", "node_modules", "x", "index.js"), "// no es de axd\n");
  const { estado: e } = estado(repo);
  assert.deepEqual(e.generados.editados_a_mano, [generado]);
  assert.equal(e.generados.mcp, false, "node_modules no cuenta como MCP generado");
  assert.match(e.salida, /editados a mano/);
  assert.match(e.salida, /persona/);
});

test("estado avisa cuando lo generado salió de un contrato que ya no es el actual", () => {
  const repo = copiaDeNodeCli();
  axd("generar", "cli", repo, "--aplicar");
  // Un verbo nuevo en el CLI del repo cambia el contrato; lo generado sigue con la huella vieja.
  const bin = join(repo, "src", "cli.ts");
  const texto = readFileSync(bin, "utf8");
  assert.match(texto, /case "listar":/, "el repo de mentira cambió: ajusta la prueba");
  writeFileSync(bin, texto.replace(/case "listar":/, 'case "archivar":\n    return archivar();\n  case "listar":'));
  const { estado: e } = estado(repo);
  assert.equal(e.generados.al_dia, false);
  assert.ok(e.generados.de_otro_contrato > 0);
  assert.match(e.salida, /contrato que ya no es el actual/);
  assert.match(e.salida, /axd generar cli/);
});

test("estado cuenta las corridas de .ax-corridas/ y da la última por nombre (empiezan por la fecha)", () => {
  const repo = copiaDeNodeCli();
  axd("generar", "cli", repo, "--aplicar");
  mkdirSync(join(repo, ".ax-corridas"));
  writeFileSync(join(repo, ".ax-corridas", "2026-10-01T10-00-00-000Z-aaaaaaaa.json"), "{}\n");
  writeFileSync(join(repo, ".ax-corridas", "2026-10-02T10-00-00-000Z-bbbbbbbb.json"), "{}\n");
  writeFileSync(join(repo, ".ax-corridas", "notas.txt"), "no cuenta\n");
  const { estado: e } = estado(repo);
  assert.deepEqual(e.corridas, { total: 2, ultima: ".ax-corridas/2026-10-02T10-00-00-000Z-bbbbbbbb.json" });
  assert.match(e.salida, /última corrida está en \.ax-corridas\/2026-10-02/);
});

test("estado sobre una ruta inexistente o con dos rutas es uso incorrecto: código 2 con la salida", () => {
  const { codigo, json } = axd("estado", join(RAIZ, "pruebas", "repos", "no-existe"));
  assert.equal(codigo, 2);
  assert.match(json["error"] as string, /No existe/);
  assert.equal(typeof json["salida"], "string");
  assert.equal(axd("estado", NODE_CLI, NODE_CLI).codigo, 2);
  assert.equal(axd("estado", "--todo", NODE_CLI).codigo, 2);
});

test("axd se aprueba en lectura barata: auditar . encuentra estado como resumen, en JSON y versionado", () => {
  const informe = axd("auditar", RAIZ).json as { ejes: { id: string; criterios: { id: string; resultado: string }[] }[] };
  const criterios = Object.fromEntries(informe.ejes.flatMap((e) => e.criterios.map((c) => [c.id, c.resultado])));
  assert.equal(criterios["lectura-barata/resumen-existe"], "cumple");
  assert.equal(criterios["lectura-barata/formato-de-maquina"], "cumple");
  assert.equal(criterios["lectura-barata/esquema-versionado"], "cumple");
  assert.notEqual(criterios["verbos-estrechos/devuelve-estado-nuevo"], "no-cumple");
});

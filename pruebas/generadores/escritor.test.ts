// El escritor en un directorio temporal, nunca en este repo: ensayo, aplicar, y negarse a pisar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../src/contrato/index.ts";
import {
  aplicar, conCabecera, ensayar, esGeneradoPorAxd, leerCabecera, type ArchivoGenerado,
} from "../../src/generadores/index.ts";
import { ErrorAx } from "../../src/modelo/index.ts";

const CONTRATO = "a".repeat(64);
const OTRO_CONTRATO = "b".repeat(64);

function temporal(): string {
  return mkdtempSync(join(tmpdir(), "axd-escritor-"));
}

const ARCHIVOS: ArchivoGenerado[] = [
  { ruta: "ax/hola.mjs", contenido: "#!/usr/bin/env node\nconsole.log(1);\n", comentario: "//", motivo: "un script" },
  { ruta: "ax/datos.json", contenido: '{\n  "a": 1\n}\n', comentario: "json", motivo: "un json" },
  { ruta: "ax/LEEME.md", contenido: "# Hola\n", comentario: "html", motivo: "un md" },
];

function codigoDe(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorAx) return e.codigo;
    throw e;
  }
  assert.fail("debía lanzar un ErrorAx");
}

test("la cabecera va tras el shebang, dentro del JSON o en la primera línea, y se lee de vuelta", () => {
  const [script, json, md] = ARCHIVOS.map((a) => conCabecera(a, CONTRATO));
  assert.match(script!.split("\n")[1]!, /^\/\/ generado por axd · contrato sha256:a{64} · contenido sha256:[0-9a-f]{64}/);
  assert.ok(script!.startsWith("#!/usr/bin/env node\n"));
  assert.deepEqual(Object.keys(JSON.parse(json!)), ["//", "a"]);
  assert.match(md!, /^<!-- generado por axd/);
  for (const texto of [script!, json!, md!]) assert.deepEqual(leerCabecera(texto), { contrato: CONTRATO, intacto: true });
  assert.deepEqual(leerCabecera(script!.replace("console.log(1)", "console.log(2)")), { contrato: CONTRATO, intacto: false });
  assert.equal(leerCabecera("console.log(1);\n"), undefined);
});

test("el ensayo dice qué crearía y por qué, y no escribe nada", () => {
  const raiz = temporal();
  const plan = ensayar(raiz, CONTRATO, ARCHIVOS);
  assert.deepEqual(plan.archivos.map((p) => [p.ruta, p.accion, p.sha256_actual]), ARCHIVOS.map((a) => [a.ruta, "crear", null]));
  assert.ok(plan.archivos.every((p) => p.motivo !== "" && p.por_que !== "" && p.bytes > 0));
  assert.equal(plan.negados, 0);
  assert.deepEqual(readdirSync(raiz), []);
});

test("aplicar escribe lo que dijo el ensayo y devuelve lo escrito con su hash", () => {
  const raiz = temporal();
  const plan = ensayar(raiz, CONTRATO, ARCHIVOS);
  const hecho = aplicar(raiz, CONTRATO, ARCHIVOS, { huellaDelEnsayo: plan.huella_del_destino });
  assert.deepEqual(hecho.escritos.map((e) => [e.ruta, e.accion]), ARCHIVOS.map((a) => [a.ruta, "crear"]));
  for (const e of hecho.escritos) {
    const texto = readFileSync(join(raiz, e.ruta), "utf8");
    assert.equal(sha256(texto), e.sha256);
    assert.equal(Buffer.byteLength(texto), e.bytes);
  }
  assert.deepEqual(hecho.escritos.map((e) => e.sha256), plan.archivos.map((p) => p.sha256));
  assert.deepEqual(readdirSync(join(raiz, "ax")).sort(), ["LEEME.md", "datos.json", "hola.mjs"], "no quedan temporales");
});

test("volver a generar lo mismo no cambia nada; con otro contrato, actualiza lo que está intacto", () => {
  const raiz = temporal();
  aplicar(raiz, CONTRATO, ARCHIVOS);
  assert.deepEqual(ensayar(raiz, CONTRATO, ARCHIVOS).archivos.map((p) => p.accion), ["sin-cambios", "sin-cambios", "sin-cambios"]);
  assert.deepEqual(aplicar(raiz, CONTRATO, ARCHIVOS), { raiz, contrato: CONTRATO, escritos: [], sin_cambios: ARCHIVOS.map((a) => a.ruta) });
  const plan = ensayar(raiz, OTRO_CONTRATO, ARCHIVOS);
  assert.deepEqual(plan.archivos.map((p) => p.accion), ["actualizar", "actualizar", "actualizar"]);
  assert.match(plan.archivos[0]!.por_que, /contrato aaaaaaaaaaaa/);
  aplicar(raiz, OTRO_CONTRATO, ARCHIVOS);
  assert.equal(leerCabecera(readFileSync(join(raiz, "ax/hola.mjs"), "utf8"))!.contrato, OTRO_CONTRATO);
});

test("se niega con 5 a pisar un archivo que no generó, en el ensayo y al aplicar, sin escribir ninguno", () => {
  const raiz = temporal();
  mkdirSync(join(raiz, "ax"));
  writeFileSync(join(raiz, "ax/datos.json"), '{ "mio": true }\n');
  const plan = ensayar(raiz, CONTRATO, ARCHIVOS);
  assert.deepEqual(plan.archivos.map((p) => p.accion), ["crear", "negado", "crear"]);
  assert.match(plan.archivos[1]!.por_que, /no lo generó axd/);
  let error: ErrorAx | undefined;
  try {
    aplicar(raiz, CONTRATO, ARCHIVOS);
  } catch (e) {
    error = e as ErrorAx;
  }
  assert.equal(error?.codigo, 5);
  assert.ok(error!.salida.length > 0);
  assert.deepEqual((error!.datos!["archivos"] as { ruta: string }[]).map((a) => a.ruta), ["ax/datos.json"]);
  assert.equal(readFileSync(join(raiz, "ax/datos.json"), "utf8"), '{ "mio": true }\n');
  assert.equal(existsSync(join(raiz, "ax/hola.mjs")), false, "no escribe nada si hay un negado");
});

test("se niega con 5 a pisar un archivo que generó pero alguien editó", () => {
  const raiz = temporal();
  aplicar(raiz, CONTRATO, ARCHIVOS);
  const ruta = join(raiz, "ax/hola.mjs");
  const editado = readFileSync(ruta, "utf8").replace("console.log(1)", "console.log('a mano')");
  writeFileSync(ruta, editado);
  const plan = ensayar(raiz, OTRO_CONTRATO, ARCHIVOS);
  assert.equal(plan.archivos[0]!.accion, "negado");
  assert.match(plan.archivos[0]!.por_que, /alguien lo cambió/);
  assert.equal(codigoDe(() => aplicar(raiz, OTRO_CONTRATO, ARCHIVOS)), 5);
  assert.equal(readFileSync(ruta, "utf8"), editado);
});

test("sale con 4 si el destino cambió entre el ensayo y aplicar", () => {
  const raiz = temporal();
  const plan = ensayar(raiz, CONTRATO, ARCHIVOS);
  mkdirSync(join(raiz, "ax"));
  writeFileSync(join(raiz, "ax/LEEME.md"), "apareció\n");
  let error: ErrorAx | undefined;
  try {
    aplicar(raiz, CONTRATO, ARCHIVOS, { huellaDelEnsayo: plan.huella_del_destino });
  } catch (e) {
    error = e as ErrorAx;
  }
  assert.equal(error?.codigo, 4);
  assert.equal(error!.reintentable, true);
  assert.equal(existsSync(join(raiz, "ax/hola.mjs")), false);
});

test("no escribe a través de un enlace ni fuera del repo", () => {
  const raiz = temporal();
  const fuera = temporal();
  symlinkSync(fuera, join(raiz, "ax"));
  assert.ok(ensayar(raiz, CONTRATO, ARCHIVOS).archivos.every((p) => p.accion === "negado"));
  assert.equal(codigoDe(() => aplicar(raiz, CONTRATO, ARCHIVOS)), 5);
  assert.deepEqual(readdirSync(fuera), []);
  assert.equal(codigoDe(() => ensayar(raiz, CONTRATO, [{ ...ARCHIVOS[0]!, ruta: "../fuera.mjs" }])), 3);
  assert.equal(codigoDe(() => ensayar(raiz, CONTRATO, [{ ...ARCHIVOS[0]!, ruta: "/tmp/x.mjs" }])), 3);
  assert.equal(codigoDe(() => ensayar(join(raiz, "no-existe"), CONTRATO, ARCHIVOS)), 2);
});

test("esGeneradoPorAxd: solo lo de ax/ que lleva la cabecera", () => {
  const texto = conCabecera(ARCHIVOS[0]!, CONTRATO);
  assert.equal(esGeneradoPorAxd("ax/hola.mjs", () => texto), true);
  assert.equal(esGeneradoPorAxd("src/hola.mjs", () => texto), false);
  assert.equal(esGeneradoPorAxd("ax/mio.mjs", () => "console.log(1);\n"), false);
});

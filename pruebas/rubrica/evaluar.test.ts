// Los 7 evaluar() contra repos de mentira: node-cli (cuidado), python-cli (mediocre, sin guía
// para agentes) y muy-malo (a propósito terrible: autoaprobación, sin huella de lectura, sin
// resumen, sin pruebas). No contra este repo ni contra uno de verdad (AGENTS.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analizar, lectorDeDisco } from "../../src/analizador/index.ts";
import { medir } from "../../src/medicion/index.ts";
import { generarInforme } from "../../src/informe/index.ts";
import { evaluarRubrica } from "../../src/rubrica/index.ts";
import { evaluar as evaluarLecturaBarata } from "../../src/rubrica/lectura-barata.ts";
import { evaluar as evaluarContratoSeparado } from "../../src/rubrica/contrato-separado-de-la-vista.ts";
import { evaluar as evaluarVerbosEstrechos } from "../../src/rubrica/verbos-estrechos.ts";
import { evaluar as evaluarEscrituraVerificada } from "../../src/rubrica/escritura-verificada.ts";
import { evaluar as evaluarContextoProgresivo } from "../../src/rubrica/contexto-progresivo.ts";
import { evaluar as evaluarErroresAccionables } from "../../src/rubrica/errores-accionables.ts";
import { evaluar as evaluarEvidenciaYTrazabilidad } from "../../src/rubrica/evidencia-y-trazabilidad.ts";
import type { CriterioDecidido, Eje, Inventario, Medicion } from "../../src/modelo/index.ts";

const REPOS = join(import.meta.dirname, "..", "repos");

function cargar(nombre: string): { inventario: Inventario; medicion: Medicion } {
  const inventario = analizar(lectorDeDisco(join(REPOS, nombre)));
  return { inventario, medicion: medir(inventario) };
}

const nodeCli = cargar("node-cli");
const pythonCli = cargar("python-cli");
const muyMalo = cargar("muy-malo");

function porId(criterios: CriterioDecidido[]): Record<string, CriterioDecidido> {
  return Object.fromEntries(criterios.map((c) => [c.id, c]));
}

// --- 1. Lectura barata ---

test("lectura-barata: node-cli tiene un verbo de resumen cumpliendo, documentado en la guía", () => {
  const c = porId(evaluarLecturaBarata(nodeCli.inventario, nodeCli.medicion));
  assert.equal(c["lectura-barata/resumen-existe"]!.resultado, "cumple");
  assert.equal(c["lectura-barata/formato-de-maquina"]!.resultado, "cumple");
  assert.equal(c["lectura-barata/costo-del-resumen"]!.resultado, "sin-evidencia", "es un verbo: medir su salida exige correrlo");
});

test("lectura-barata: muy-malo no tiene ningún camino de resumen, con su ausencia repetible", () => {
  const c = porId(evaluarLecturaBarata(muyMalo.inventario, muyMalo.medicion));
  const resumen = c["lectura-barata/resumen-existe"]!;
  assert.equal(resumen.resultado, "no-cumple");
  assert.equal(resumen.critico, true);
  assert.deepEqual(resumen.evidencia, [
    { tipo: "ausencia", buscado: "verbo, endpoint o tool con nombre estado, status, resumen, contexto o summary, o un archivo de estado del dominio con ese nombre", en: "superficies.cli, superficies.api, superficies.mcp_tools y estado[] del Inventario" },
  ]);
  // Lo que exige resumen-existe se pisa en cascada en no-aplica: no hay nada que describir.
  assert.equal(c["lectura-barata/formato-de-maquina"]!.resultado, "no-aplica");
  assert.equal(c["lectura-barata/esquema-versionado"]!.resultado, "no-aplica");
});

// --- 2. Contrato separado de la vista ---

test("contrato-separado-de-la-vista: node-cli separa dominio e interfaz y documenta el modelo", () => {
  const c = porId(evaluarContratoSeparado(nodeCli.inventario));
  assert.equal(c["contrato-separado-de-la-vista/dominio-legible"]!.resultado, "cumple");
  assert.equal(c["contrato-separado-de-la-vista/interfaz-aparte"]!.resultado, "cumple");
  assert.equal(c["contrato-separado-de-la-vista/modelo-sobre-el-almacenamiento"]!.resultado, "cumple");
});

test("contrato-separado-de-la-vista: muy-malo no documenta su formato ni tiene una capa de modelo", () => {
  const c = porId(evaluarContratoSeparado(muyMalo.inventario));
  assert.equal(c["contrato-separado-de-la-vista/contrato-documentado"]!.resultado, "no-cumple");
  assert.equal(c["contrato-separado-de-la-vista/modelo-sobre-el-almacenamiento"]!.resultado, "no-cumple");
});

// --- 3. Verbos estrechos, y transiciones con dueño ---

test("verbos-estrechos: sin-autoaprobacion es el crítico, y muy-malo lo pisa con un verbo «aprobar»", () => {
  const c = porId(evaluarVerbosEstrechos(muyMalo.inventario));
  const sinAuto = c["verbos-estrechos/sin-autoaprobacion"]!;
  assert.equal(sinAuto.critico, true);
  assert.equal(sinAuto.resultado, "no-cumple");
  assert.deepEqual(sinAuto.evidencia, [{ tipo: "archivo", ruta: "src/cli.ts", linea: 5 }]);
});

test("verbos-estrechos: node-cli no tiene verbo que se autoapruebe", () => {
  const c = porId(evaluarVerbosEstrechos(nodeCli.inventario));
  assert.notEqual(c["verbos-estrechos/sin-autoaprobacion"]!.resultado, "no-cumple");
  assert.equal(c["verbos-estrechos/superficie-estrecha"]!.resultado, "cumple");
});

// --- 4. Escritura verificada e idempotente ---

test("escritura-verificada: reintento-seguro nunca sale cumple o no-cumple en axd auditar", () => {
  for (const { inventario } of [nodeCli, pythonCli]) {
    const c = porId(evaluarEscrituraVerificada(inventario));
    const reintento = c["escritura-verificada/reintento-seguro"]!;
    assert.equal(reintento.resultado, "sin-evidencia");
    assert.equal(reintento.valor, null);
    assert.deepEqual(reintento.evidencia, [], "una corrida es del validador; auditar no la produce");
  }
});

test("escritura-verificada: node-cli verifica una huella y escribe atómico; muy-malo, ninguna de las dos", () => {
  const bueno = porId(evaluarEscrituraVerificada(nodeCli.inventario));
  assert.equal(bueno["escritura-verificada/huella-de-lectura"]!.resultado, "cumple");
  assert.equal(bueno["escritura-verificada/escritura-atomica"]!.resultado, "cumple");

  const malo = porId(evaluarEscrituraVerificada(muyMalo.inventario));
  const huella = malo["escritura-verificada/huella-de-lectura"]!;
  assert.equal(huella.resultado, "no-cumple");
  assert.equal(huella.critico, true);
  assert.equal(malo["escritura-verificada/escritura-atomica"]!.resultado, "no-cumple");
});

// --- 5. Contexto progresivo ---

test("contexto-progresivo: muy-malo no tiene guía de entrada ni entidades con id", () => {
  const c = porId(evaluarContextoProgresivo(muyMalo.inventario, muyMalo.medicion));
  assert.equal(c["contexto-progresivo/guia-de-entrada-acotada"]!.resultado, "no-cumple");
  assert.equal(c["contexto-progresivo/identificadores-estables"]!.resultado, "no-cumple");
});

test("contexto-progresivo: node-cli tiene una guía de entrada barata", () => {
  const c = porId(evaluarContextoProgresivo(nodeCli.inventario, nodeCli.medicion));
  assert.equal(c["contexto-progresivo/guia-de-entrada-acotada"]!.resultado, "cumple");
});

// --- 6. Errores que dicen qué hacer ---

test("errores-accionables: muy-malo no construye ningún error estructurado", () => {
  const c = porId(evaluarErroresAccionables(muyMalo.inventario));
  assert.equal(c["errores-accionables/errores-estructurados"]!.resultado, "no-cumple");
  assert.equal(c["errores-accionables/nombran-la-salida"]!.resultado, "sin-evidencia", "no hay construcciones de error que medir");
});

test("errores-accionables: node-cli tiene un manejador y errores con salida accionable", () => {
  const c = porId(evaluarErroresAccionables(nodeCli.inventario));
  assert.equal(c["errores-accionables/errores-estructurados"]!.resultado, "cumple");
});

// --- 7. Evidencia y trazabilidad ---

test("evidencia-y-trazabilidad: el verbo «entregar» de node-cli pide evidencia y se niega sin ella", () => {
  const c = porId(evaluarEvidenciaYTrazabilidad(nodeCli.inventario));
  assert.equal(c["evidencia-y-trazabilidad/entrega-con-evidencia"]!.resultado, "cumple");
  assert.equal(c["evidencia-y-trazabilidad/registro-de-quien-hizo-que"]!.resultado, "cumple");
});

test("evidencia-y-trazabilidad: muy-malo no tiene bitácora, pruebas ni verbo de entrega", () => {
  const c = porId(evaluarEvidenciaYTrazabilidad(muyMalo.inventario));
  assert.equal(c["evidencia-y-trazabilidad/entrega-con-evidencia"]!.resultado, "no-aplica");
  assert.equal(c["evidencia-y-trazabilidad/registro-de-quien-hizo-que"]!.resultado, "no-cumple");
  assert.equal(c["evidencia-y-trazabilidad/pruebas-repetibles"]!.resultado, "no-cumple");
});

// --- El informe completo: los 7 ejes juntos ---

test("evaluarRubrica da los 7 ejes, en orden y con nivel donde la cobertura alcanza", () => {
  const ejes = evaluarRubrica(nodeCli.inventario, nodeCli.medicion);
  assert.equal(ejes.length, 7);
  assert.deepEqual(ejes.map((e) => e.numero), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(ejes.every((e) => e.criterios.length >= 3));
});

test("muy-malo audita muy por debajo de node-cli, con varios ejes topados por un crítico", () => {
  const ejesBuenos = evaluarRubrica(nodeCli.inventario, nodeCli.medicion);
  const ejesMalos = evaluarRubrica(muyMalo.inventario, muyMalo.medicion);
  const informeBueno = generarInforme(nodeCli.inventario.raiz, ejesBuenos);
  const informeMalo = generarInforme(muyMalo.inventario.raiz, ejesMalos);
  assert.ok(informeBueno.puntuacion_global !== null && informeMalo.puntuacion_global !== null);
  assert.ok(informeMalo.puntuacion_global! < informeBueno.puntuacion_global!, `${informeMalo.puntuacion_global} debería ser menor que ${informeBueno.puntuacion_global}`);
  const topados = ejesMalos.filter((e: Eje) => e.criterios.some((c) => c.critico && c.resultado === "no-cumple"));
  assert.ok(topados.length >= 3, "lectura-barata, verbos-estrechos y escritura-verificada deberían topar por su crítico");
  for (const eje of topados) assert.ok(eje.nivel === null || eje.nivel <= 1, `${eje.id}: el crítico debería topar el nivel a incipiente como mucho`);
});

test("el Informe de muy-malo sobrevive a JSON sin perder nada, y los críticos en no-cumple van primero", () => {
  const ejes = evaluarRubrica(muyMalo.inventario, muyMalo.medicion);
  const informe = generarInforme(muyMalo.inventario.raiz, ejes);
  assert.deepEqual(JSON.parse(JSON.stringify(informe)), informe);
  const primerNoCritico = informe.hallazgos.findIndex((h) => !(h.critico && h.resultado === "no-cumple"));
  const ultimoCritico = informe.hallazgos.findLastIndex((h) => h.critico && h.resultado === "no-cumple");
  assert.ok(primerNoCritico === -1 || ultimoCritico === -1 || ultimoCritico < primerNoCritico, "ningún crítico en no-cumple aparece después de uno que no lo es");
});

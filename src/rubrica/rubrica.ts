// rubrica.ts: junta los 7 evaluar() de cada eje en los Eje[] de la auditoría. Aplica sobre lo que
// cada evaluar() ya decidió la escala de criterios.json (puntuación, cobertura, nivel, la regla
// del crítico y la del eje entero no-aplica); no vuelve a mirar el Inventario ni la Medicion.
import type { CriterioDecidido, Eje, Evidencia, Hallazgo, Inventario, Medicion } from "../modelo/index.ts";
import { COBERTURA_MINIMA, type CriterioJson, criterioJson, ejeJson, NIVELES } from "./comun.ts";
import { evaluar as evaluarLecturaBarata } from "./lectura-barata.ts";
import { evaluar as evaluarContratoSeparadoDeLaVista } from "./contrato-separado-de-la-vista.ts";
import { evaluar as evaluarVerbosEstrechos } from "./verbos-estrechos.ts";
import { evaluar as evaluarEscrituraVerificada } from "./escritura-verificada.ts";
import { evaluar as evaluarContextoProgresivo } from "./contexto-progresivo.ts";
import { evaluar as evaluarErroresAccionables } from "./errores-accionables.ts";
import { evaluar as evaluarEvidenciaYTrazabilidad } from "./evidencia-y-trazabilidad.ts";

/** Los 7 ejes, en el orden de la rúbrica y de docs/rubrica.md. */
const EJES: { id: string; evaluar: (inventario: Inventario, medicion: Medicion) => CriterioDecidido[] }[] = [
  { id: "lectura-barata", evaluar: evaluarLecturaBarata },
  { id: "contrato-separado-de-la-vista", evaluar: (inv) => evaluarContratoSeparadoDeLaVista(inv) },
  { id: "verbos-estrechos", evaluar: (inv) => evaluarVerbosEstrechos(inv) },
  { id: "escritura-verificada", evaluar: (inv) => evaluarEscrituraVerificada(inv) },
  { id: "contexto-progresivo", evaluar: evaluarContextoProgresivo },
  { id: "errores-accionables", evaluar: (inv) => evaluarErroresAccionables(inv) },
  { id: "evidencia-y-trazabilidad", evaluar: (inv) => evaluarEvidenciaYTrazabilidad(inv) },
];

/** `peso × (2 − valor)`: cuánto le falta a un criterio que no cumple del todo. */
function brechaDe(c: CriterioDecidido): number {
  return c.peso * (2 - (c.valor as number));
}

/**
 * Para los criterios de impacto «contexto» con una medición de tokens y un umbral «<=» (cuanto
 * menos, mejor): lo que ahorraría llegar al umbral de `cumple`. Para el resto (impacto «riesgo»,
 * umbrales «>=» como una razón de ahorro, o sin medición) no hay un número de tokens que calcular:
 * es solo el desempate de la regla 3, no todo hallazgo lo necesita.
 */
function ahorroTokensDe(cj: CriterioJson, c: CriterioDecidido): number | null {
  if (c.impacto !== "contexto" || cj.metrica === undefined || cj.metrica.cumple.op !== "<=") return null;
  const medicion = c.evidencia.find((e): e is Evidencia & { tipo: "medicion" } => e.tipo === "medicion");
  if (medicion === undefined) return null;
  const ahorro = Math.round(medicion.tokens - cj.metrica.cumple.valor);
  return ahorro > 0 ? ahorro : null;
}

function construirHallazgo(ejeId: string, numeroEje: number, ordenCriterio: number, c: CriterioDecidido): Hallazgo {
  const slug = c.id.slice(ejeId.length + 1);
  const cj = criterioJson(ejeId, slug);
  return {
    criterio: c.id,
    eje: ejeId,
    numero_eje: numeroEje,
    orden_criterio: ordenCriterio,
    resultado: c.resultado as "parcial" | "no-cumple",
    critico: c.critico,
    brecha: brechaDe(c),
    impacto: c.impacto,
    ahorro_tokens: ahorroTokensDe(cj, c),
    motivo: c.motivo,
    evidencia: c.evidencia,
  };
}

/** Expuesta para probar la escala (regla del crítico, cobertura mínima, eje entero no-aplica)
 *  con CriterioDecidido[] a mano, sin pasar por las heurísticas de un evaluar() concreto. */
export function puntuarEje(ejeId: string, criterios: CriterioDecidido[]): Eje {
  const ej = ejeJson(ejeId);
  const aplican = criterios.filter((c) => c.resultado !== "no-aplica");
  if (aplican.length === 0) {
    const motivo = criterios[0]?.motivo ?? "Todos los criterios de este eje son no-aplica.";
    return {
      id: ej.id, numero: ej.numero, nombre: ej.nombre, pregunta: ej.pregunta as Eje["pregunta"],
      puntuacion: null, nivel: null, nombre_nivel: null, cobertura: null,
      no_aplica: true, motivo_no_aplica: motivo, criterios, hallazgos: [],
    };
  }
  const cuentan = aplican.filter((c) => c.valor !== null);
  const pesoAplica = aplican.reduce((a, c) => a + c.peso, 0);
  const pesoCuenta = cuentan.reduce((a, c) => a + c.peso, 0);
  const cobertura = pesoAplica > 0 ? Math.round((pesoCuenta / pesoAplica) * 100) / 100 : 0;
  const puntuacion = cuentan.length === 0
    ? null
    : Math.round((100 * cuentan.reduce((a, c) => a + c.peso * (c.valor as number), 0)) / cuentan.reduce((a, c) => a + c.peso * 2, 0));

  let nivel: number | null = null;
  let nombreNivel: string | null = null;
  if (puntuacion !== null && cobertura >= COBERTURA_MINIMA) {
    const tramo = NIVELES.find((t) => puntuacion >= t.desde && puntuacion < t.hasta) ?? NIVELES[NIVELES.length - 1]!;
    const criticoEnNoCumple = criterios.some((c) => c.critico && c.resultado === "no-cumple");
    nivel = criticoEnNoCumple ? Math.min(tramo.nivel, 1) : tramo.nivel;
    nombreNivel = NIVELES.find((t) => t.nivel === nivel)!.nombre;
  }

  const hallazgos = criterios
    .filter((c) => c.resultado === "parcial" || c.resultado === "no-cumple")
    .map((c) => construirHallazgo(ej.id, ej.numero, ej.criterios.findIndex((k) => k.id === c.id), c));

  return {
    id: ej.id, numero: ej.numero, nombre: ej.nombre, pregunta: ej.pregunta as Eje["pregunta"],
    puntuacion, nivel, nombre_nivel: nombreNivel, cobertura,
    no_aplica: false, motivo_no_aplica: null, criterios, hallazgos,
  };
}

/** Los 7 Eje[], en orden. Es la única función que un evaluar() de fuera de este módulo necesita llamar. */
export function evaluarRubrica(inventario: Inventario, medicion: Medicion): Eje[] {
  return EJES.map(({ id, evaluar }) => puntuarEje(id, evaluar(inventario, medicion)));
}

/**
 * Los hallazgos de los 7 ejes, juntos y ordenados por docs/rubrica.md: primero los críticos en
 * no-cumple, luego por brecha, luego por el ahorro de tokens de los de impacto contexto, y a
 * igualdad por eje y por el orden del criterio en criterios.json.
 */
export function ordenarHallazgos(ejes: readonly Eje[]): Hallazgo[] {
  const prioridad = (h: Hallazgo): 0 | 1 => (h.critico && h.resultado === "no-cumple" ? 0 : 1);
  return ejes.flatMap((eje) => eje.hallazgos).sort((a, b) => {
    if (prioridad(a) !== prioridad(b)) return prioridad(a) - prioridad(b);
    if (a.brecha !== b.brecha) return b.brecha - a.brecha;
    const ahorroA = a.ahorro_tokens ?? -1;
    const ahorroB = b.ahorro_tokens ?? -1;
    if (ahorroA !== ahorroB) return ahorroB - ahorroA;
    if (a.numero_eje !== b.numero_eje) return a.numero_eje - b.numero_eje;
    return a.orden_criterio - b.orden_criterio;
  });
}

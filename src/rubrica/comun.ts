// Infraestructura que comparten los 7 evaluar(): leer un criterio de criterios.json (un dato de
// axd, no del repo objetivo; se carga como módulo JSON, no con node:fs) y construir su
// CriterioDecidido con la escala fija (cumple 2 · parcial 1 · no-cumple 0 · no-aplica · sin-evidencia).
// Así cada eje solo escribe la heurística propia, nunca la forma del resultado ni la comparación
// con un umbral.
import type { CriterioDecidido, Evidencia, Impacto, Inventario, Manejador, Resultado, Ruta, Senal, TipoDeSenal } from "../modelo/index.ts";
import { ErrorAx } from "../modelo/index.ts";
import rubrica from "./criterios.json" with { type: "json" };

/** Cuántas líneas después de donde se declara un verbo se miran buscando lo que hace al terminar
 *  (serializar, dar un siguiente paso...). El analizador da señales línea a línea, no por función,
 *  así que una ventana es la aproximación: generosa para no castigar funciones normales, acotada
 *  para no mezclar el verbo con el siguiente. */
export const VENTANA_DE_VERBO = 20;

export type Operador = "<=" | ">=";

export type CriterioJson = {
  id: string;
  enunciado: string;
  fuente: "inventario" | "medicion" | "corrida";
  peso: number;
  critico: boolean;
  impacto: Impacto;
  como_se_mide: string;
  metrica?: { nombre: string; unidad: string; cumple: { op: Operador; valor: number }; parcial: { op: Operador; valor: number } };
  cumple: string;
  parcial: string;
  no_cumple: string;
  no_aplica_si: string | null;
  evidencia: string[];
};

type EjeJson = { id: string; numero: number; nombre: string; pregunta: string; peso: number; criterios: CriterioJson[] };
type RubricaJson = { esquema: 1; version: number; ejes: EjeJson[] };

export type NivelJson = { nivel: number; nombre: string; desde: number; hasta: number };
type RubricaJsonCompleta = RubricaJson & { escala: { cobertura_minima: number; niveles: NivelJson[] } };

const DATOS = rubrica as RubricaJsonCompleta;

export const COBERTURA_MINIMA: number = DATOS.escala.cobertura_minima;
export const NIVELES: NivelJson[] = DATOS.escala.niveles;

/** Un criterio que el código pide y criterios.json no tiene: es un fallo de axd, no del repo auditado. */
function falloDeRubrica(mensaje: string): ErrorAx {
  return new ErrorAx(mensaje, {
    codigo: 3,
    salida: "Compara src/rubrica/criterios.json con el id que pide el código y corrige el que esté mal; `node --test pruebas/rubrica` lo comprueba.",
  });
}

export function ejeJson(id: string): EjeJson {
  const eje = DATOS.ejes.find((e) => e.id === id);
  if (!eje) throw falloDeRubrica(`criterios.json no tiene el eje «${id}»: revisa que no se haya renombrado.`);
  return eje;
}

/** El criterio `<ejeId>/<slug>` de criterios.json; lanza si no existe (es un error de axd, no del repo objetivo). */
export function criterioJson(ejeId: string, slug: string): CriterioJson {
  const id = `${ejeId}/${slug}`;
  const criterio = ejeJson(ejeId).criterios.find((c) => c.id === id);
  if (!criterio) throw falloDeRubrica(`criterios.json no tiene el criterio «${id}»: revisa que no se haya renombrado.`);
  return criterio;
}

const VALOR: Record<Resultado, number | null> = {
  cumple: 2,
  parcial: 1,
  "no-cumple": 0,
  "no-aplica": null,
  "sin-evidencia": null,
};

function decidido(c: CriterioJson, resultado: Resultado, motivo: string, evidencia: Evidencia[]): CriterioDecidido {
  return { id: c.id, resultado, valor: VALOR[resultado], peso: c.peso, critico: c.critico, impacto: c.impacto, motivo, evidencia };
}

export function cumple(c: CriterioJson, motivo: string, evidencia: Evidencia[] = []): CriterioDecidido {
  return decidido(c, "cumple", motivo, evidencia);
}

export function parcial(c: CriterioJson, motivo: string, evidencia: Evidencia[] = []): CriterioDecidido {
  return decidido(c, "parcial", motivo, evidencia);
}

export function noCumple(c: CriterioJson, motivo: string, evidencia: Evidencia[] = []): CriterioDecidido {
  return decidido(c, "no-cumple", motivo, evidencia);
}

export function noAplica(c: CriterioJson, motivo: string): CriterioDecidido {
  return decidido(c, "no-aplica", motivo, []);
}

/** `fuente: "corrida"`, o cualquier otro criterio que aplique pero no se pueda decidir con lo disponible. */
export function sinEvidencia(c: CriterioJson, motivo: string): CriterioDecidido {
  return decidido(c, "sin-evidencia", motivo, []);
}

/** Compara `valor` contra `c.metrica`: primero el umbral de cumple, luego el de parcial, si no no-cumple. */
export function porMetrica(c: CriterioJson, valor: number, evidencia: Evidencia[] = []): CriterioDecidido {
  const m = c.metrica;
  if (!m) throw falloDeRubrica(`${c.id}: no tiene metrica en criterios.json`);
  const pasa = (u: { op: Operador; valor: number }) => (u.op === "<=" ? valor <= u.valor : valor >= u.valor);
  const motivo = `${m.nombre} = ${valor} ${m.unidad}.`;
  if (pasa(m.cumple)) return cumple(c, motivo, evidencia);
  if (pasa(m.parcial)) return parcial(c, motivo, evidencia);
  return noCumple(c, motivo, evidencia);
}

export function evidenciaArchivo(ruta: Ruta, linea: number): Evidencia {
  return { tipo: "archivo", ruta, linea };
}

export function evidenciaAusencia(buscado: string, en: string): Evidencia {
  return { tipo: "ausencia", buscado, en };
}

export function evidenciaMedicion(camino: string, tokens: number, archivos?: Ruta[]): Evidencia {
  return archivos === undefined ? { tipo: "medicion", camino, tokens } : { tipo: "medicion", camino, tokens, archivos };
}

/** `proporcion` con dos decimales, o undefined si no hay nada que dividir (denominador 0). */
export function proporcion(parte: number, total: number): number | undefined {
  return total === 0 ? undefined : Math.round((parte / total) * 100) / 100;
}

/** Todas las señales de `tipo` del Inventario, opcionalmente solo en ciertos archivos. */
export function senalesDeTipo(inventario: Inventario, tipo: TipoDeSenal, archivos?: readonly Ruta[]): Senal[] {
  return inventario.senales.filter((s) => s.tipo === tipo && (archivos === undefined || archivos.includes(s.archivo)));
}

/** Si hay alguna señal de alguno de `tipos`, en `archivo`, entre `linea` y `linea + ventana`. */
export function haySenalCerca(
  inventario: Inventario,
  archivo: Ruta,
  linea: number,
  tipos: readonly TipoDeSenal[],
  ventana = VENTANA_DE_VERBO,
): Senal | undefined {
  return inventario.senales.find((s) => s.archivo === archivo && tipos.includes(s.tipo) && s.linea >= linea && s.linea <= linea + ventana);
}

/** Las líneas del despacho mismo: la del verbo y las dos siguientes, las mismas en que el
 *  analizador busca a qué función despacha un `case`. Un case que hace el trabajo ahí
 *  (`return console.log(JSON.stringify({ esquema: 1, ...leerEstado() }))`) lo hace ahí, aunque la
 *  última llamada lleve a otra función. */
export const LINEAS_DEL_DESPACHO = 2;

/** Dónde mirar lo que hace un verbo: las líneas de su despacho y su manejador entero si el
 *  analizador siguió el despacho (de su línea a su fin, en su archivo, que puede ser otro módulo,
 *  más las funciones locales a las que llama); si no, la ventana de VENTANA_DE_VERBO tras donde se
 *  declara. */
export type VerboUbicado = { archivo: Ruta; linea: number; manejador?: Manejador | undefined };

export function haySenalEnElVerbo(inventario: Inventario, verbo: VerboUbicado, tipos: readonly TipoDeSenal[]): Senal | undefined {
  const m = verbo.manejador;
  if (m === undefined) return haySenalCerca(inventario, verbo.archivo, verbo.linea, tipos);
  const enElDespacho = haySenalCerca(inventario, verbo.archivo, verbo.linea, tipos, LINEAS_DEL_DESPACHO);
  if (enElDespacho !== undefined) return enElDespacho;
  const archivo = m.archivo ?? verbo.archivo;
  for (const r of [m, ...(m.llama ?? [])]) {
    const senal = haySenalCerca(inventario, archivo, r.linea, tipos, r.hasta - r.linea);
    if (senal !== undefined) return senal;
  }
  return undefined;
}

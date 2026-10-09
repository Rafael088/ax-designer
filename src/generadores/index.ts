// generadores: Contrato → archivos en el repo objetivo. Cada generador solo produce la lista de
// archivos; quien decide si se puede escribir, y escribe, es el escritor.
import type { Contrato } from "../modelo/index.ts";
import { aplicar, ensayar, exigirSinNegados, type Aplicado, type ArchivoGenerado, type Plan } from "./escritor.ts";
import { archivosCli } from "./cli/index.ts";
import { archivosMcp } from "./mcp/index.ts";

export { CARPETA_DE_CORRIDAS, CARPETA_GENERADA, anexarALaGuia, aplicar, borrarCarpetaTemporal, crearCarpetaTemporal, escribirCopia, escribirCorrida, escribirTranscripcion, conCabecera, ensayar, esGeneradoPorAxd, exigirSinNegados, leerCabecera } from "./escritor.ts";
export type { Aplicado, ArchivoGenerado, Escrito, Plan, PasoDelPlan } from "./escritor.ts";
export { archivosMcp, esquemaDeEntrada } from "./mcp/index.ts";
export { archivosCli, datosDelCli, RUTA_DEL_LEEME_DEL_CLI } from "./cli/index.ts";

export type Generador = "cli" | "mcp";

export const GENERADORES: readonly Generador[] = ["cli", "mcp"];

export function archivosDe(generador: Generador, contrato: Contrato): ArchivoGenerado[] {
  return generador === "mcp" ? archivosMcp(contrato) : archivosCli(contrato);
}

export type Generado =
  | ({ ensayo: true; generador: Generador } & Plan)
  | ({ ensayo: false; generador: Generador } & Aplicado);

/** Sin `aplicar`, el ensayo (que falla con 5 si hay algo que no se pisaría); con `aplicar`, lo escrito. */
export function generar(generador: Generador, contrato: Contrato, raiz: string, opciones: { aplicar: boolean; huella?: string }): Generado {
  const archivos = archivosDe(generador, contrato);
  if (!opciones.aplicar) {
    const plan = ensayar(raiz, contrato.huella, archivos);
    exigirSinNegados(plan);
    return { ensayo: true, generador, ...plan };
  }
  return { ensayo: false, generador, ...aplicar(raiz, contrato.huella, archivos, opciones.huella !== undefined ? { huellaDelEnsayo: opciones.huella } : {}) };
}

// ax/contrato.json: el contrato del que salen el CLI y el MCP, versionado en el repo objetivo. Lo
// escriben los dos generadores con el mismo contenido, así que el segundo lo ve «sin cambios».
import type { Contrato } from "../modelo/index.ts";
import { CARPETA_GENERADA, type ArchivoGenerado } from "./escritor.ts";

export const RUTA_DEL_CONTRATO = `${CARPETA_GENERADA}/contrato.json`;

/** El contrato tal como se guarda en el repo: sin `raiz`, que depende de cómo se pidió. */
export function contratoParaElRepo(contrato: Contrato): string {
  const { raiz: _raiz, ...resto } = contrato;
  return JSON.stringify(resto, null, 2) + "\n";
}

export function archivoDelContrato(contrato: Contrato): ArchivoGenerado {
  return { ruta: RUTA_DEL_CONTRATO, contenido: contratoParaElRepo(contrato), comentario: "json", motivo: "El contrato del que salen el CLI y el MCP, versionado en el repo." };
}

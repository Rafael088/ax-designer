// Las copias en las que trabaja el agente, en el temporal del sistema: el repo objetivo nunca se
// toca. Se preparan dos plantillas —«sin», el repo tal cual, y «con», el repo con `generar cli` y
// `generar mcp` aplicados por el escritor y el SDK del MCP instalado por el motor— y cada corrida
// trabaja en una copia nueva de su plantilla, para que una no herede lo que hizo la anterior.
//
// Lo que ya hubiera generado axd en el repo no se copia a ninguna: si no, el «sin» llevaría la
// herramienta puesta.
import { join } from "node:path";
import type { Contrato, CorridaPlaneada, Variante } from "../modelo/index.ts";
import { leerArbol } from "../analizador/index.ts";
import { borrarCarpetaTemporal, crearCarpetaTemporal, esGeneradoPorAxd, escribirCopia, generar } from "../generadores/index.ts";
import type { Motor } from "./motor.ts";

/** Lo que no pasa a las copias. Sin node_modules, el agente trabaja sin las dependencias del repo en las dos variantes. */
export const EXCLUIDAS_DE_LA_COPIA = [".git", "node_modules", ".ax-corridas"] as const;

export type Copias = { temporal: string; plantillas: Record<Variante, string> };

export function prepararPlantillas(raiz: string, contrato: Contrato, motor: Motor): Copias {
  const temporal = crearCarpetaTemporal();
  try {
    const archivos = leerArbol(raiz, EXCLUIDAS_DE_LA_COPIA, esGeneradoPorAxd);
    const sin = join(temporal, "plantilla-sin");
    const con = join(temporal, "plantilla-con");
    escribirCopia(sin, archivos);
    escribirCopia(con, archivos);
    generar("cli", contrato, con, { aplicar: true });
    generar("mcp", contrato, con, { aplicar: true });
    motor.prepararCon(con);
    return { temporal, plantillas: { sin, con } };
  } catch (e) {
    borrarCarpetaTemporal(temporal);
    throw e;
  }
}

/** Una copia nueva de la plantilla de la variante, solo para esta corrida. */
export function copiaParaCorrida(copias: Copias, corrida: CorridaPlaneada): string {
  const destino = join(copias.temporal, "corridas", corrida.id.replaceAll("/", "-"), "repo");
  escribirCopia(destino, leerArbol(copias.plantillas[corrida.variante], []));
  return destino;
}

export function limpiar(copias: Copias): void {
  borrarCarpetaTemporal(copias.temporal);
}

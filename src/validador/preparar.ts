// Las copias en las que trabaja el agente, en el temporal del sistema: el repo objetivo nunca se
// toca. Se preparan dos plantillas —«sin», el repo tal cual, y «con», el repo con `generar cli`
// aplicado por el escritor y, según el modo, `generar mcp` con el SDK del MCP instalado por el
// motor y una línea en la guía que el agente carga solo que apunta a ax/cli.md— y cada corrida
// trabaja en una copia nueva de su plantilla, para que una no herede lo que hizo la anterior.
//
// Lo que ya hubiera generado axd en el repo no se copia a ninguna: si no, el «sin» llevaría la
// herramienta puesta.
import { join } from "node:path";
import type { Contrato, CorridaPlaneada, ModoCon, Variante } from "../modelo/index.ts";
import { leerArbol } from "../analizador/index.ts";
import { anexarALaGuia, borrarCarpetaTemporal, crearCarpetaTemporal, esGeneradoPorAxd, escribirCopia, generar, RUTA_DEL_LEEME_DEL_CLI } from "../generadores/index.ts";
import type { Motor } from "./motor.ts";

/** Lo que no pasa a las copias. Sin node_modules, el agente trabaja sin las dependencias del repo en las dos variantes. */
export const EXCLUIDAS_DE_LA_COPIA = [".git", "node_modules", ".ax-corridas"] as const;

export type Copias = { temporal: string; plantillas: Record<Variante, string> };

/** Si el «con» lleva el MCP generado. */
export function conMcp(con: ModoCon): boolean {
  return con !== "cli";
}

/** Si el «con» lleva la línea en la guía que apunta a ax/cli.md. */
export function conLineaEnLaGuia(con: ModoCon): boolean {
  return con !== "mcp";
}

/** La línea que se añade a la guía de la copia «con»: el agente la carga solo y encuentra el CLI sin buscarlo. */
export function lineaDeLaGuia(contrato: Contrato): string {
  const programa = [contrato.cli.programa, ...contrato.cli.argumentos].join(" ");
  return `Para consultar o cambiar los datos de este repo hay un CLI de verbos para agentes: \`${programa} --help\` los lista y \`${programa} <verbo> --help\` da sus entradas; el detalle está en ${RUTA_DEL_LEEME_DEL_CLI}.`;
}

export function prepararPlantillas(raiz: string, contrato: Contrato, motor: Motor, con: ModoCon = "ambos"): Copias {
  const temporal = crearCarpetaTemporal();
  try {
    const archivos = leerArbol(raiz, EXCLUIDAS_DE_LA_COPIA, esGeneradoPorAxd);
    const sin = join(temporal, "plantilla-sin");
    const conHerramienta = join(temporal, "plantilla-con");
    escribirCopia(sin, archivos);
    escribirCopia(conHerramienta, archivos);
    generar("cli", contrato, conHerramienta, { aplicar: true });
    if (conMcp(con)) {
      generar("mcp", contrato, conHerramienta, { aplicar: true });
      motor.prepararCon(conHerramienta);
    }
    if (conLineaEnLaGuia(con)) anexarALaGuia(conHerramienta, motor.guia, lineaDeLaGuia(contrato));
    return { temporal, plantillas: { sin, con: conHerramienta } };
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
